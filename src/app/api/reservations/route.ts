import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { cleanupExpiredReservations } from "@/lib/cleanup";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Zod Schema for reservation request validation
const reserveSchema = z.object({
  productId: z.string().uuid("Invalid Product ID"),
  warehouseId: z.string().uuid("Invalid Warehouse ID"),
  quantity: z.number().int().positive("Quantity must be a positive integer"),
});

export async function POST(req: NextRequest) {
  const idempotencyKey = req.headers.get("idempotency-key");

  try {
    // Parse and validate the request body
    const body = await req.json();
    const parseResult = reserveSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { productId, warehouseId, quantity } = parseResult.data;

    // 1. Handle Idempotency Key check/lock if present
    if (idempotencyKey) {
      try {
        const existingKey = await prisma.idempotencyKey.findUnique({
          where: { key: idempotencyKey },
        });

        if (existingKey) {
          if (existingKey.status === "PROCESSING") {
            return NextResponse.json(
              { error: "Request already in progress" },
              { status: 409 }
            );
          }

          // Return cached completed response
          if (existingKey.responseBody && existingKey.responseStatus) {
            return new NextResponse(existingKey.responseBody, {
              status: existingKey.responseStatus,
              headers: {
                "Content-Type": "application/json",
                "x-idempotency-cache": "HIT",
              },
            });
          }
        }

        // Insert new key in PROCESSING status
        await prisma.idempotencyKey.create({
          data: {
            key: idempotencyKey,
            status: "PROCESSING",
          },
        });
      } catch (dbError) {
        // Unique key constraint violation due to concurrent double-submission
        return NextResponse.json(
          { error: "Request already in progress" },
          { status: 409 }
        );
      }
    }

    // 2. Process Reservation atomically inside a transaction
    let reservation;
    try {
      reservation = await prisma.$transaction(async (tx) => {
        // Run lazy cleanup first so we have accurate stock totals
        await cleanupExpiredReservations(tx);

        // Perform the atomic stock update
        // We increment reservedUnits ONLY if totalUnits - reservedUnits >= quantity
        const updatedRows = await tx.$executeRaw`
          UPDATE "Stock"
          SET "reservedUnits" = "reservedUnits" + ${quantity}
          WHERE "productId" = ${productId}
            AND "warehouseId" = ${warehouseId}
            AND "totalUnits" - "reservedUnits" >= ${quantity}
        `;

        if (updatedRows === 0) {
          throw new Error("INSUFFICIENT_STOCK");
        }

        // Insert reservation
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
        return await tx.reservation.create({
          data: {
            productId,
            warehouseId,
            quantity,
            status: "PENDING",
            expiresAt,
          },
          include: {
            product: true,
            warehouse: true,
          },
        });
      });
    } catch (txError: any) {
      if (txError.message === "INSUFFICIENT_STOCK") {
        const errorResponse = { error: "Insufficient stock available" };
        
        // Save failed response if using idempotency key
        if (idempotencyKey) {
          await prisma.idempotencyKey.update({
            where: { key: idempotencyKey },
            data: {
              status: "COMPLETED",
              responseStatus: 409,
              responseBody: JSON.stringify(errorResponse),
            },
          });
        }

        return NextResponse.json(errorResponse, { status: 409 });
      }

      throw txError; // Bubbles up to outer catch for 500 error
    }

    const successResponse = {
      message: "Stock successfully reserved",
      reservation: {
        id: reservation.id,
        productId: reservation.productId,
        productName: reservation.product.name,
        warehouseId: reservation.warehouseId,
        warehouseName: reservation.warehouse.name,
        quantity: reservation.quantity,
        status: reservation.status,
        expiresAt: reservation.expiresAt,
      },
    };

    // 3. Cache the successful response if using idempotency key
    if (idempotencyKey) {
      await prisma.idempotencyKey.update({
        where: { key: idempotencyKey },
        data: {
          status: "COMPLETED",
          responseStatus: 201,
          responseBody: JSON.stringify(successResponse),
        },
      });
    }

    return NextResponse.json(successResponse, { status: 201 });

  } catch (error) {
    console.error("Failed to process reservation:", error);

    // Clean up idempotency key on unexpected error so client can retry
    if (idempotencyKey) {
      try {
        await prisma.idempotencyKey.delete({ where: { key: idempotencyKey } });
      } catch (cleanupError) {
        // Ignore
      }
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
