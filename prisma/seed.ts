import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("Cleaning up existing data...");
  // Delete in order of dependencies
  await prisma.idempotencyKey.deleteMany({});
  await prisma.reservation.deleteMany({});
  await prisma.stock.deleteMany({});
  await prisma.warehouse.deleteMany({});
  await prisma.product.deleteMany({});

  console.log("Seeding products...");
  const product1 = await prisma.product.create({
    data: {
      name: "Allo Smart Hub",
      description: "The premium central controller for inventory tracking, featuring high-speed syncing and glassmorphic telemetry displays.",
      sku: "ALLO-SH-001",
      price: 149.99,
      imageUrl: "https://images.unsplash.com/photo-1546054454-aa26e2b734c7?auto=format&fit=crop&q=80&w=600",
    },
  });

  const product2 = await prisma.product.create({
    data: {
      name: "Allo Pro Sensor",
      description: "Smart BLE-enabled ambient tracking sensor with 5-year battery life. Perfect for large industrial warehouses.",
      sku: "ALLO-PS-002",
      price: 49.99,
      imageUrl: "https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&q=80&w=600",
    },
  });

  const product3 = await prisma.product.create({
    data: {
      name: "Allo Beacon Light",
      description: "Highly visible multicolor LED visual cue for rapid order sorting. Connects natively to the Allo Smart Hub.",
      sku: "ALLO-BL-003",
      price: 29.99,
      imageUrl: "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&q=80&w=600",
    },
  });

  console.log("Seeding warehouses...");
  const warehouseSF = await prisma.warehouse.create({
    data: {
      name: "San Francisco Fulfillment Center (US-WEST)",
      location: "San Francisco, CA",
    },
  });

  const warehouseNY = await prisma.warehouse.create({
    data: {
      name: "New York Fulfillment Center (US-EAST)",
      location: "Brooklyn, NY",
    },
  });

  console.log("Seeding stock levels...");
  // US-WEST SF Stock
  await prisma.stock.createMany({
    data: [
      {
        productId: product1.id,
        warehouseId: warehouseSF.id,
        totalUnits: 10,
        reservedUnits: 0,
      },
      {
        productId: product2.id,
        warehouseId: warehouseSF.id,
        totalUnits: 25,
        reservedUnits: 0,
      },
      {
        productId: product3.id,
        warehouseId: warehouseSF.id,
        totalUnits: 50,
        reservedUnits: 0,
      },
    ],
  });

  // US-EAST NY Stock
  await prisma.stock.createMany({
    data: [
      {
        productId: product1.id,
        warehouseId: warehouseNY.id,
        totalUnits: 5,
        reservedUnits: 0,
      },
      {
        productId: product2.id,
        warehouseId: warehouseNY.id,
        totalUnits: 15,
        reservedUnits: 0,
      },
      {
        productId: product3.id,
        warehouseId: warehouseNY.id,
        totalUnits: 30,
        reservedUnits: 0,
      },
    ],
  });

  console.log("Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error("Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
