import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { cleanupExpiredReservations } from "@/lib/cleanup";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    console.log("[Cron Cleanup] Starting bulk release of expired reservations...");
    
    // Perform cleanup using our core utility inside a transaction
    const releasedCount = await prisma.$transaction(async (tx) => {
      return await cleanupExpiredReservations(tx);
    });

    console.log(`[Cron Cleanup] Finished. Released ${releasedCount} expired reservations.`);

    return NextResponse.json({
      success: true,
      message: `Released ${releasedCount} expired reservations.`,
      releasedCount,
    });
  } catch (error) {
    console.error("[Cron Cleanup] Critical error during bulk release:", error);
    return NextResponse.json(
      { error: "Internal server error during bulk cleanup" },
      { status: 500 }
    );
  }
}
