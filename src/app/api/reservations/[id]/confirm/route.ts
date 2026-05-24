import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const idempotencyKey = req.headers.get("idempotency-key");

  try {
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

    // 2. Process Confirmation inside a transaction
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        // Fetch the reservation
        const reservation = await tx.reservation.findUnique({
          where: { id },
          include: {
            product: true,
            warehouse: true,
          },
        });

        if (!reservation) {
          throw new Error("NOT_FOUND");
        }

        if (reservation.status === "CONFIRMED") {
          // Already confirmed, return a success response (idempotency safety)
          return {
            status: 200,
            payload: {
              message: "Reservation already confirmed",
              reservation: {
                id: reservation.id,
                status: reservation.status,
                quantity: reservation.quantity,
                productName: reservation.product.name,
                warehouseName: reservation.warehouse.name,
              },
            },
          };
        }

        if (reservation.status === "RELEASED") {
          throw new Error("ALREADY_RELEASED");
        }

        const now = new Date();
        // Check if expired
        if (reservation.expiresAt < now) {
          // Expiry occurred! We must release the stock hold and update status to RELEASED
          await tx.reservation.update({
            where: { id },
            data: { status: "RELEASED" },
          });

          // Return the reservedUnits count to stock pool
          await tx.stock.update({
            where: {
              productId_warehouseId: {
                productId: reservation.productId,
                warehouseId: reservation.warehouseId,
              },
            },
            data: {
              reservedUnits: { decrement: reservation.quantity },
            },
          });

          throw new Error("EXPIRED");
        }

        // Transition reservation status to CONFIRMED
        const updatedReservation = await tx.reservation.update({
          where: { id },
          data: { status: "CONFIRMED" },
        });

        // Permanently decrement totalUnits (physical stock) and release reservedUnits (hold)
        await tx.stock.update({
          where: {
            productId_warehouseId: {
              productId: reservation.productId,
              warehouseId: reservation.warehouseId,
            },
          },
          data: {
            totalUnits: { decrement: reservation.quantity },
            reservedUnits: { decrement: reservation.quantity },
          },
        });

        return {
          status: 200,
          payload: {
            message: "Reservation successfully confirmed",
            reservation: {
              id: updatedReservation.id,
              status: updatedReservation.status,
              quantity: updatedReservation.quantity,
              productName: reservation.product.name,
              warehouseName: reservation.warehouse.name,
            },
          },
        };
      });
    } catch (txError: any) {
      let status = 500;
      let errorResponse = { error: "Internal server error" };

      if (txError.message === "NOT_FOUND") {
        status = 404;
        errorResponse = { error: "Reservation not found" };
      } else if (txError.message === "ALREADY_RELEASED") {
        status = 400;
        errorResponse = { error: "Cannot confirm a released reservation" };
      } else if (txError.message === "EXPIRED") {
        status = 410;
        errorResponse = { error: "Reservation has expired and stock was released" };
      }

      // Save failed response if using idempotency key
      if (idempotencyKey && status !== 500) {
        await prisma.idempotencyKey.update({
          where: { key: idempotencyKey },
          data: {
            status: "COMPLETED",
            responseStatus: status,
            responseBody: JSON.stringify(errorResponse),
          },
        });
      }

      if (status !== 500) {
        return NextResponse.json(errorResponse, { status });
      }
      throw txError;
    }

    // 3. Cache the successful response if using idempotency key
    if (idempotencyKey) {
      await prisma.idempotencyKey.update({
        where: { key: idempotencyKey },
        data: {
          status: "COMPLETED",
          responseStatus: result.status,
          responseBody: JSON.stringify(result.payload),
        },
      });
    }

    return NextResponse.json(result.payload, { status: result.status });

  } catch (error) {
    console.error(`Failed to confirm reservation ${id}:`, error);

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
