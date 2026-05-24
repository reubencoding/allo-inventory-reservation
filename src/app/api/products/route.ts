import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { cleanupExpiredReservations } from "@/lib/cleanup";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Perform lazy cleanup of expired reservations first
    await cleanupExpiredReservations(prisma);

    // Fetch products with their stock levels and warehouses
    const products = await prisma.product.findMany({
      include: {
        stocks: {
          include: {
            warehouse: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    // Format the response for standard consumption
    const formattedProducts = products.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      sku: product.sku,
      price: product.price,
      imageUrl: product.imageUrl,
      stocks: product.stocks.map((stock) => ({
        id: stock.id,
        warehouseId: stock.warehouse.id,
        warehouseName: stock.warehouse.name,
        location: stock.warehouse.location,
        totalUnits: stock.totalUnits,
        reservedUnits: stock.reservedUnits,
        availableUnits: Math.max(0, stock.totalUnits - stock.reservedUnits),
      })),
    }));

    return NextResponse.json(formattedProducts);
  } catch (error) {
    console.error("Failed to fetch products:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
