import { z } from "zod";
import type {
    SabahCapability,
    SabahActor,
    CapabilityRisk,
} from "./contracts";
import { assertCapabilityAllowed } from "../security/hard-boundaries";

export type CapabilitySummary = {
    name: string;
    version: number;
    module: string;
    description: string;
    risk: CapabilityRisk | "DYNAMIC";
};

export type CapabilityDescription = CapabilitySummary & {
    inputJsonSchema: Record<string, unknown>;
    outputJsonSchema: Record<string, unknown>;
};

// Simple Zod to JSON Schema converter
// Covers: object, string, number, boolean, enum (literal union), optional, nullable, array, record
function zodToJsonSchema(zodType: z.ZodType): Record<string, unknown> {
    const schema: Record<string, unknown> = {};

    const process = (type: z.ZodType): Record<string, unknown> => {
        const node: Record<string, unknown> = {};

        // Handle optional (ZodOptional)
        if (type instanceof z.ZodOptional) {
            const inner = process(type._def.innerType);
            return { ...inner, isOptional: true };
        }

        // Handle nullable (ZodNullable)
        if (type instanceof z.ZodNullable) {
            const inner = process(type._def.innerType);
            return { ...inner, isNullable: true };
        }

        // Handle default (ZodDefault)
        if (type instanceof z.ZodDefault) {
            const inner = process(type._def.innerType);
            return { ...inner, default: type._def.defaultValue() };
        }

        // Handle ZodEffects (refinements, transforms, etc.)
        if (type instanceof z.ZodEffects) {
            return process(type._def.schema);
        }

        // Handle ZodLazy (recursive types)
        if (type instanceof z.ZodLazy) {
            return process(type._def.getter());
        }

        // Handle primitive types
        if (type instanceof z.ZodString) {
            node.type = "string";
        } else if (type instanceof z.ZodNumber) {
            node.type = "number";
        } else if (type instanceof z.ZodBoolean) {
            node.type = "boolean";
        } else if (type instanceof z.ZodVoid) {
            node.type = "void";
        } else if (type instanceof z.ZodUndefined) {
            node.type = "undefined";
        } else if (type instanceof z.ZodNull) {
            node.type = "null";
        } else if (type instanceof z.ZodAny || type instanceof z.ZodUnknown) {
            node.type = "any";
        } else if (type instanceof z.ZodLiteral) {
            node.type = typeof type._def.value;
            node.const = type._def.value;
        } else if (type instanceof z.ZodEnum) {
            node.type = "string";
            node.enum = type._def.values;
        } else if (type instanceof z.ZodNativeEnum) {
            node.type = "string";
            node.enum = Object.values(type._def.values);
        } else if (type instanceof z.ZodUnion) {
            // Handle union as oneOf
            node.oneOf = type._def.options.map((opt: unknown) =>
                process(opt as z.ZodType)
            );
        } else if (type instanceof z.ZodDiscriminatedUnion) {
            node.oneOf = Object.values(type._def.options).map((opt: unknown) =>
                process(opt as z.ZodType)
            );
        } else if (type instanceof z.ZodIntersection) {
            // Intersection - combine allOf
            node.allOf = [process(type._def.left), process(type._def.right)];
        } else if (type instanceof z.ZodTuple) {
            node.type = "array";
            node.items = type._def.items.map((item: z.ZodType) => process(item));
        } else if (type instanceof z.ZodArray) {
            node.type = "array";
            node.items = process(type._def.type);
            if (type._def.minLength !== null) {
                node.minItems = type._def.minLength.value;
            }
            if (type._def.maxLength !== null) {
                node.maxItems = type._def.maxLength.value;
            }
        } else if (type instanceof z.ZodObject) {
            node.type = "object";
            node.properties = {};

            const shape = type._def.shape();
            const required: string[] = [];

            for (const [key, value] of Object.entries(shape)) {
                const fieldSchema = process(value as z.ZodType);
                if (node.properties) {
                    (node.properties as Record<string, unknown>)[key] = fieldSchema;
                }

                // Check if the field is required (not optional)
                if (
                    !(value instanceof z.ZodOptional) &&
                    !(value instanceof z.ZodNullable)
                ) {
                    required.push(key);
                }
            }

            if (required.length > 0) {
                node.required = required;
            }

            // Note: strict mode check - ZodObjectDef may not have strict property in all versions
            // We'll skip this for now as it's not critical for JSON Schema generation
        } else if (type instanceof z.ZodRecord) {
            node.type = "object";
            node.additionalProperties = process(type._def.valueType);
        } else if (type instanceof z.ZodMap) {
            node.type = "object";
            node.additionalProperties = process(type._def.valueType);
        } else if (type instanceof z.ZodSet) {
            node.type = "array";
            node.uniqueItems = true;
            // ZodSet doesn't expose type directly, skip items schema for now
        } else if (type instanceof z.ZodBigInt) {
            node.type = "integer";
        } else if (type instanceof z.ZodFunction) {
            node.type = "function";
        } else if (type instanceof z.ZodPromise) {
            node.type = "promise";
            node.result = process(type._def.type);
        } else if (type instanceof z.ZodBranded) {
            return process(type._def.type);
        } else if (type instanceof z.ZodReadonly) {
            return process(type._def.innerType);
        } else if (type instanceof z.ZodCatch) {
            return process(type._def.innerType);
        }

        return node;
    };

    return process(zodType);
}

export class CapabilityRegistry {
    private readonly definitions = new Map<
        string,
        SabahCapability<unknown, unknown>
    >();

    private key(name: string, version: number): string {
        return `${name}@${version}`;
    }

    register<I, O>(definition: SabahCapability<I, O>): void {
        assertCapabilityAllowed(definition.name);
        const k = this.key(definition.name, definition.version);

        if (this.definitions.has(k)) {
            throw new Error(`${k} already registered`);
        }

        this.definitions.set(k, definition as SabahCapability<unknown, unknown>);
    }

    resolve(name: string, version?: number): SabahCapability<unknown, unknown> {
        if (version !== undefined) {
            const k = this.key(name, version);
            const capability = this.definitions.get(k);

            if (!capability) {
                throw new Error(
                    `Capability ${name}@${version} not found in registry`
                );
            }

            return capability;
        }

        // Find highest version
        let highestVersion = -1;
        let highestCapability: SabahCapability<unknown, unknown> | null = null;

        for (const [, capability] of Array.from(this.definitions.entries())) {
            if (capability.name === name && capability.version > highestVersion) {
                highestVersion = capability.version;
                highestCapability = capability;
            }
        }

        if (!highestCapability) {
            throw new Error(`Capability ${name} not found in registry`);
        }

        return highestCapability;
    }

    async search(
        query: string,
        actor: SabahActor
    ): Promise<CapabilitySummary[]> {
        return this.searchInternal(query, actor, 20);
    }

    /** Return the complete actor-authorized set for a server-side paginator. */
    async searchAll(
        query: string,
        actor: SabahActor,
    ): Promise<CapabilitySummary[]> {
        return this.searchInternal(query, actor, null);
    }

    private async searchInternal(
        query: string,
        actor: SabahActor,
        maxResults: number | null,
    ): Promise<CapabilitySummary[]> {
        const normalizedQuery = query.toLowerCase().trim();
        const results: CapabilitySummary[] = [];

        for (const capability of Array.from(this.definitions.values())) {
            // Check availability for actor
            const isAvailable = await capability.available(actor);
            if (!isAvailable) {
                continue;
            }

            // Match against normalized query
            const nameMatch = capability.name.toLowerCase().includes(normalizedQuery);
            const moduleMatch = capability.module
                .toLowerCase()
                .includes(normalizedQuery);
            const descriptionMatch = capability.description
                .toLowerCase()
                .includes(normalizedQuery);

            if (nameMatch || moduleMatch || descriptionMatch) {
                const risk =
                    typeof capability.risk === "function"
                        ? "DYNAMIC"
                        : capability.risk;

                results.push({
                    name: capability.name,
                    version: capability.version,
                    module: capability.module,
                    description: capability.description,
                    risk,
                });
            }
        }

        return maxResults === null ? results : results.slice(0, maxResults);
    }

    async describe(
        requests: Array<{ name: string; version?: number }>,
        actor: SabahActor
    ): Promise<CapabilityDescription[]> {
        const descriptions: CapabilityDescription[] = [];

        for (const request of requests) {
            try {
                const capability = this.resolve(request.name, request.version);

                // Check availability for actor
                const isAvailable = await capability.available(actor);
                if (!isAvailable) {
                    continue;
                }

                const risk =
                    typeof capability.risk === "function"
                        ? "DYNAMIC"
                        : capability.risk;

                descriptions.push({
                    name: capability.name,
                    version: capability.version,
                    module: capability.module,
                    description: capability.description,
                    risk,
                    inputJsonSchema: zodToJsonSchema(capability.inputSchema),
                    outputJsonSchema: zodToJsonSchema(capability.outputSchema),
                });
            } catch {
                // Skip capabilities that don't exist or fail to resolve
                continue;
            }
        }

        return descriptions;
    }
}

// Singleton instance
export const capabilityRegistry = new CapabilityRegistry();