import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Password123!';

async function hash(password: string) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

async function main() {
  console.log('Seeding OrderFlow database...');

  const passwordHash = await hash(DEMO_PASSWORD);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@orderflow.dev' },
    update: {},
    create: {
      email: 'admin@orderflow.dev',
      passwordHash,
      firstName: 'Ada',
      lastName: 'Admin',
      role: 'ADMIN',
    },
  });

  const staff = await prisma.user.upsert({
    where: { email: 'staff@orderflow.dev' },
    update: {},
    create: {
      email: 'staff@orderflow.dev',
      passwordHash,
      firstName: 'Sam',
      lastName: 'Staff',
      role: 'STAFF',
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: 'customer@orderflow.dev' },
    update: {},
    create: {
      email: 'customer@orderflow.dev',
      passwordHash,
      firstName: 'Casey',
      lastName: 'Customer',
      role: 'CUSTOMER',
    },
  });

  const customer2 = await prisma.user.upsert({
    where: { email: 'customer2@orderflow.dev' },
    update: {},
    create: {
      email: 'customer2@orderflow.dev',
      passwordHash,
      firstName: 'Chris',
      lastName: 'Buyer',
      role: 'CUSTOMER',
    },
  });

  const products = [
    {
      sku: 'SKU-MUG-001',
      name: 'OrderFlow Ceramic Mug',
      description: '12oz ceramic mug with OrderFlow logo',
      priceCents: 1899,
      category: 'merchandise',
      quantity: 50,
    },
    {
      sku: 'SKU-TEE-001',
      name: 'Backend Engineer Tee',
      description: 'Soft cotton tee for builders who ship',
      priceCents: 2999,
      category: 'apparel',
      quantity: 30,
    },
    {
      sku: 'SKU-STICKER-001',
      name: 'Sticker Pack',
      description: 'Vinyl sticker pack — inventory, queues, and locks',
      priceCents: 599,
      category: 'merchandise',
      quantity: 200,
    },
    {
      sku: 'SKU-BOOK-001',
      name: 'Distributed Systems Notes',
      description: 'Printable notes on idempotency and outbox patterns',
      priceCents: 2499,
      category: 'digital',
      quantity: 100,
    },
    {
      sku: 'SKU-LIMITED-001',
      name: 'Limited Edition Keycap',
      description: 'Only a few left — good for concurrency demos',
      priceCents: 4999,
      category: 'merchandise',
      quantity: 1,
    },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: {
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        category: p.category,
        isActive: true,
      },
      create: {
        sku: p.sku,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        category: p.category,
        inventory: {
          create: {
            availableQuantity: p.quantity,
            reservedQuantity: 0,
            soldQuantity: 0,
          },
        },
      },
    });

    // Ensure inventory quantity for upserts that already existed without inventory update
    const product = await prisma.product.findUnique({ where: { sku: p.sku } });
    if (product) {
      await prisma.inventory.upsert({
        where: { productId: product.id },
        update: { availableQuantity: p.quantity },
        create: {
          productId: product.id,
          availableQuantity: p.quantity,
          reservedQuantity: 0,
          soldQuantity: 0,
        },
      });
    }
  }

  console.log('Seed complete.');
  console.log('');
  console.log('Demo accounts (password for all: Password123!):');
  console.log(`  ADMIN     ${admin.email}`);
  console.log(`  STAFF     ${staff.email}`);
  console.log(`  CUSTOMER  ${customer.email}`);
  console.log(`  CUSTOMER  ${customer2.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
