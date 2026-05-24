import prisma from "./prisma";

/**
 * Lazily releases expired pending reservations and updates stock levels accordingly.
 * Runs atomically inside or outside an existing transaction.
 */
export async function cleanupExpiredReservations(
  tx: any = prisma
): Promise<number> {
  const now = new Date();

  // Find all pending reservations that have expired
  const expiredReservations = await tx.reservation.findMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: now },
    },
  });

  if (expiredReservations.length === 0) {
    return 0;
  }

  console.log(`[Lazy Cleanup] Found ${expiredReservations.length} expired reservations.`);

  let releasedCount = 0;

  for (const res of expiredReservations) {
    try {
      // Mark reservation as RELEASED
      await tx.reservation.update({
        where: { id: res.id },
        data: { status: "RELEASED" },
      });

      // Release reserved units
      await tx.stock.update({
        where: {
          productId_warehouseId: {
            productId: res.productId,
            warehouseId: res.warehouseId,
          },
        },
        data: {
          reservedUnits: { decrement: res.quantity },
        },
      });

      releasedCount++;
    } catch (error) {
      console.error(`[Lazy Cleanup] Failed to release reservation ${res.id}:`, error);
    }
  }

  return releasedCount;
}
