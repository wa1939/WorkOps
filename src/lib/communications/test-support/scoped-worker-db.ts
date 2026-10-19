import { Prisma, type PrismaClient } from "@prisma/client";

function scopeClaimQuery(query: Prisma.Sql, deliveryIds: readonly string[]): Prisma.Sql {
    const orderByMarker = 'ORDER BY d."createdAt" ASC, d."id" ASC';
    const orderByIndex = query.strings.findIndex((part) => part.includes(orderByMarker));
    if (orderByIndex === -1) throw new Error("Worker test claim scope could not locate the production ordering clause");

    const orderByPart = query.strings[orderByIndex];
    const markerOffset = orderByPart.indexOf(orderByMarker);
    const strings = [...query.strings];
    strings.splice(
        orderByIndex,
        1,
        `${orderByPart.slice(0, markerOffset)}AND d."id" IN (`,
        ...deliveryIds.slice(1).map(() => ","),
        `) ${orderByPart.slice(markerOffset)}`,
    );
    const values = [...query.values];
    values.splice(orderByIndex, 0, ...deliveryIds);
    return Prisma.sql(strings, ...values);
}

function scopedDeliveryDelegate(
    delegate: PrismaClient["delivery"],
    deliveryIds: readonly string[],
): PrismaClient["delivery"] {
    const ids = [...deliveryIds];
    return new Proxy(delegate, {
        get(target, property, receiver) {
            if (property === "updateMany") {
                return (args: Parameters<PrismaClient["delivery"]["updateMany"]>[0]) => target.updateMany({
                    ...args,
                    where: {
                        AND: [args.where ?? {}, { id: { in: ids } }],
                    },
                });
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

function scopedTransaction(
    transaction: Prisma.TransactionClient,
    deliveryIds: readonly string[],
): Prisma.TransactionClient {
    const scopedDelivery = scopedDeliveryDelegate(transaction.delivery, deliveryIds);
    return new Proxy(transaction, {
        get(target, property, receiver) {
            if (property === "$queryRaw") {
                return (query: Prisma.Sql) => target.$queryRaw<Array<{ id: string }>>(
                    scopeClaimQuery(query, deliveryIds),
                );
            }
            if (property === "delivery") return scopedDelivery;
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

export function createScopedWorkerDb(
    client: PrismaClient,
    deliveryIds: readonly string[],
): PrismaClient {
    const scopedDelivery = scopedDeliveryDelegate(client.delivery, deliveryIds);
    return new Proxy(client, {
        get(target, property, receiver) {
            if (property === "$transaction") {
                return (callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(
                    (transaction) => callback(scopedTransaction(transaction, deliveryIds)),
                );
            }
            if (property === "delivery") return scopedDelivery;
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}
