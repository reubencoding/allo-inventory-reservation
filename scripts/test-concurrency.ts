import { prisma } from "../src/lib/prisma";
import { cleanupExpiredReservations } from "../src/lib/cleanup";

async function runConcurrencyTest() {
  console.log("=========================================");
  console.log("ALLOCATION CONCURRENCY VALIDATION SUITE");
  console.log("=========================================");

  // 1. Setup specific test entities
  console.log("\n[1/4] Provisioning isolation test units...");
  
  // Clean up any old test product
  await prisma.reservation.deleteMany({
    where: { product: { sku: "CONCURRENCY-TEST-SKU" } }
  });
  await prisma.stock.deleteMany({
    where: { product: { sku: "CONCURRENCY-TEST-SKU" } }
  });
  await prisma.product.deleteMany({
    where: { sku: "CONCURRENCY-TEST-SKU" }
  });

  const testProduct = await prisma.product.create({
    data: {
      name: "Concurrency Test Unit",
      description: "SKU reserved for concurrency race conditions testing.",
      sku: "CONCURRENCY-TEST-SKU",
      price: 99.99,
    }
  });

  // Find a warehouse to use
  let warehouse = await prisma.warehouse.findFirst();
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({
      data: {
        name: "Test Fulfillment Center",
        location: "Test Location, USA"
      }
    });
  }

  // Provision EXACTLY 1 unit of stock
  const testStock = await prisma.stock.create({
    data: {
      productId: testProduct.id,
      warehouseId: warehouse.id,
      totalUnits: 1, // Exactly 1 unit physically available!
      reservedUnits: 0
    }
  });

  console.log(`- Product created: "${testProduct.name}" (SKU: ${testProduct.sku})`);
  console.log(`- Warehouse: "${warehouse.name}"`);
  console.log(`- Initial Stock: ${testStock.totalUnits} total, ${testStock.reservedUnits} reserved. Available = 1.`);

  // 2. Spawn 50 concurrent reservation request simulations in parallel
  const CONCURRENCY_COUNT = 50;
  console.log(`\n[2/4] Triggering ${CONCURRENCY_COUNT} parallel reservation attempts simultaneously...`);

  const reservationAttempt = async (index: number) => {
    try {
      // Simulate the exact API transaction block
      const res = await prisma.$transaction(async (tx: any) => {
        // Run lazy cleanup (simulation of raw workflow)
        await cleanupExpiredReservations(tx);

        // Atomic row-locked update
        const updated = await tx.$executeRaw`
          UPDATE "Stock"
          SET "reservedUnits" = "reservedUnits" + 1
          WHERE "productId" = ${testProduct.id}
            AND "warehouseId" = ${warehouse!.id}
            AND "totalUnits" - "reservedUnits" >= 1
        `;

        if (updated === 0) {
          throw new Error("INSUFFICIENT_STOCK");
        }

        // Insert reservation record
        return await tx.reservation.create({
          data: {
            productId: testProduct.id,
            warehouseId: warehouse!.id,
            quantity: 1,
            status: "PENDING",
            expiresAt: new Date(Date.now() + 10 * 60 * 1000)
          }
        });
      });

      return { index, success: true, reservationId: res.id };
    } catch (err: any) {
      return { index, success: false, error: err.message };
    }
  };

  const startTime = Date.now();
  
  // Fire all requests at the exact same instant using Promise.all
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY_COUNT }).map((_, i) => reservationAttempt(i))
  );
  
  const endTime = Date.now();
  console.log(`- Concurrency run completed in ${endTime - startTime}ms.`);

  // 3. Analyze results
  console.log("\n[3/4] Running audit metrics...");
  
  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);

  console.log(`- Successful holds: ${successes.length}`);
  console.log(`- Conflicting failures (409): ${failures.length}`);

  // 4. Assert correctness
  console.log("\n[4/4] Assertion checklist:");
  
  const assert1 = successes.length === 1;
  const assert2 = failures.length === CONCURRENCY_COUNT - 1;
  
  // Read final stock count from database
  const finalStock = await prisma.stock.findUnique({
    where: { id: testStock.id }
  });
  
  const finalReservations = await prisma.reservation.count({
    where: { productId: testProduct.id, status: "PENDING" }
  });

  const assert3 = finalStock?.reservedUnits === 1;
  const assert4 = finalReservations === 1;

  console.log(`- Exactly 1 holds succeeds: ${assert1 ? "PASS" : "FAIL"}`);
  console.log(`- Exactly ${CONCURRENCY_COUNT - 1} holds fail: ${assert2 ? "PASS" : "FAIL"}`);
  console.log(`- Final reservedUnits count is 1: ${assert3 ? "PASS" : "FAIL"}`);
  console.log(`- Total pending reservations in DB is 1: ${assert4 ? "PASS" : "FAIL"}`);

  console.log("\n=========================================");
  if (assert1 && assert2 && assert3 && assert4) {
    console.log("VERIFICATION: SUCCESS 🎉");
    console.log("THE ATOMIC RESERVATION LOCK IS 100% RACE-CONDITION-FREE!");
  } else {
    console.log("VERIFICATION: FAILED ❌");
    console.log("CONCURRENCY RACES WERE DETECTED!");
  }
  console.log("=========================================\n");

  await prisma.$disconnect();
}

runConcurrencyTest().catch(async (e) => {
  console.error("Concurrency runner encountered an error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
