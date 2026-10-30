import {
  productAnalyticsDeletedSchema,
  productAnalyticsPageSchema,
  productAnalyticsQuerySchema,
  productAnalyticsReceiptSchema,
  productAnalyticsRecordSchema,
  recordProductEventInputSchema,
  type ProductAnalyticsQuery,
  type ProductAnalyticsRecord,
  type RecordProductEventInput,
} from "../../../../packages/navigation-core/contracts-analytics";
import type { ServiceRequestContext } from "../capabilities";
import type { IdentitySession } from "./identity-contracts";
import type { AuthorizationContextReader } from "./authorization-policy";
import {
  withAuthorization,
  type AuthorizedRepositories,
} from "./authorization";

export interface ProductAnalyticsTransaction extends AuthorizationContextReader {
  /** Locks and rechecks current consent until this transaction commits. */
  recordProductEvent(
    input: RecordProductEventInput,
  ): Promise<{ recorded: boolean }>;
  listProductEvents(
    query: ProductAnalyticsQuery,
  ): Promise<
    (Omit<ProductAnalyticsRecord, "recordedAt"> & { recordedAt: Date })[]
  >;
  deleteProductEvents(): Promise<bigint>;
}
type Principal = Pick<IdentitySession, "accountId">;

/** Product data uses actor scope; operational and audit records have separate owners. */
export class ProductAnalyticsService {
  constructor(
    private readonly repositories: AuthorizedRepositories<ProductAnalyticsTransaction>,
  ) {}

  async record(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const input = recordProductEventInputSchema.parse(raw);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "analytics.record",
      async (repository) =>
        productAnalyticsReceiptSchema.parse(
          await repository.recordProductEvent(input),
        ),
      context,
    );
  }

  async list(
    principal: Principal,
    workspaceId: string,
    rawQuery: unknown,
    context: ServiceRequestContext,
  ) {
    const query = productAnalyticsQuerySchema.parse(rawQuery);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "analytics.read",
      async (repository) => {
        const items = (await repository.listProductEvents(query)).map((row) =>
          productAnalyticsRecordSchema.parse({
            schemaVersion: row.schemaVersion,
            eventId: row.eventId,
            event: row.event,
            recordedAt: row.recordedAt.toISOString(),
          }),
        );
        return productAnalyticsPageSchema.parse({
          items,
          ...(items.length === query.limit
            ? { nextCursor: items.at(-1)!.eventId }
            : {}),
        });
      },
      context,
    );
  }

  async delete(
    principal: Principal,
    workspaceId: string,
    context: ServiceRequestContext,
  ) {
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "analytics.delete",
      async (repository) =>
        productAnalyticsDeletedSchema.parse({
          deleted: (await repository.deleteProductEvents()).toString(),
        }),
      context,
    );
  }
}
