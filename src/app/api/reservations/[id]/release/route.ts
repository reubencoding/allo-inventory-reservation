import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      // Fetch reservation
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

      if (reservation.status === "RELEASED") {
        // Already released, return success (idempotence)
        return {
          status: 200,
          payload: {
            message: "Reservation already released",
            reservation: {
              id: reservation.id,
              status: reservation.status,
              productName: reservation.product.name,
              warehouseName: reservation.warehouse.name,
            },
          },
        };
      }

      if (reservation.status === "CONFIRMED") {
        throw new Error("CANNOT_RELEASE_CONFIRMED");
      }

      // Transition status to RELEASED
      const updatedReservation = await tx.reservation.update({
        where: { id },
        data: { status: "RELEASED" },
      });

      // Release reserved stock units
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

      return {
        status: 200,
        payload: {
          message: "Reservation successfully released early",
          reservation: {
            id: updatedReservation.id,
            status: updatedReservation.status,
            productName: reservation.product.name,
            warehouseName: reservation.warehouse.name,
          },
        },
      };
    });

    return NextResponse.json(result.payload, { status: result.status });

  } catch (txError: any) {
    if (txError.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    if (txError.message === "CANNOT_RELEASE_CONFIRMED") {
      return NextResponse.json(
        { error: "Cannot release a confirmed purchase reservation" },
        { status: 400 }
      );
    }

    console.error(`Failed to release reservation ${id}:`, txError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
