# @emporix/api-calls

Framework-agnostic typed wrappers over the Emporix REST API (axios). The
template already creates the client in `src/api/bootstrap.ts`; every call then
uses that shared instance, which injects `Authorization: Bearer <token>`,
`Emporix-Tenant`, `Accept-Language: *`, `Content-Language: *`.

Check the installed version's surface before relying on a name:

```bash
grep -o 'export { [^}]* }' node_modules/@emporix/api-calls/dist/index.d.ts
cat node_modules/@emporix/api-calls/dist/calls/<domain>.d.ts     # exact signatures
```

## Conventions

- First argument is always `tenant` (from `useExtensionContext()`).
- Paginated list calls take `Partial<PaginationProps>` (`currentPage`, `rows`,
  `sortField`, `sortOrder`, `filters`) and return `{ values, totalRecords }`
  or a domain-specific shape — read the `.d.ts`.
- Errors are axios errors; `ValidationError` carries `errors: FieldError[]`.
  Wrap calls in try/catch, `console.error`, show `useToast().showError`, and
  call `appState.onError?.(err)` when present so the host can re-authenticate.
- `fetchAllRecords` (utils) drains a paginated call.

## Domains exported (abridged — the installed `dist/index.d.ts` is the authority)

| Domain | Calls (abridged) |
|---|---|
| client | `createApiClient`, `setApiClient`, `getApiClient`, `resetApiClient` |
| products | `fetchProducts(tenant, q, fields)`, `fetchPaginatedProduct`, `fetchProductCall`, `createProductCall`, `updateProductCall`, `patchProductCall`, `deleteProductCall`, templates, `triggerDynamicVariantRecalculationCall` |
| productsMedia | `getProductImagesCall`, `addProductImageToCloudinaryCall`, `deleteProductImageCall`, `addImageToProductCall` |
| categories / catalogs | `getCategories`, `fetchCategory`, `createNewCategory`, `modifyCategory`, `getCategoryTreesCall`, `assignProductToCategoryCall`, `fetchCatalogs`, `createNewCatalog`, … |
| prices / prices_v2 / priceLists / priceModels | `searchPricesCall`, `getPricesForProduct`, `createPriceV2Call`, `fetchPriceListsCall`, `getPriceModels`, … |
| availability | `fetchAvailabilityForProduct`, `searchAvailabilitiesCall`, `updateProductAvailabilityCall` |
| orders | `getOrdersCall`, `getOrder`, `changeSalesOrderStatus`, `getPossibleStatusChanges`, `patchOrderCall`, `getOrdersToCsv`, `sendInvoiceCall`, `orderDeliveryNoteCall` |
| carts / quotes / returns | `searchCartsCall`, `getCartByIdCall`, `getQuotesCall`, `createQuoteCall`, `getReturnsCall`, `createReturnCall`, … |
| customers / customerManagement | `getCustomers`, `getCustomer`, `addCustomer`, `updateCustomer`, addresses; legal entities, locations, contacts, contact assignments |
| iam | users, groups, scopes, access controls (`getUsersCall`, `getGroupsCall`, `getScopesForUserCall`, …) |
| customEntities / customInstances | `getCustomEntitiesCall`, `upsertCustomEntityCall`; `getCustomInstancesCall(tenant, type, pagination)`, `getCustomInstanceByIdCall`, `postCustomInstanceCall`, `upsertCustomInstanceCall`, `deleteCustomInstanceCall` — use these for extension-owned data |
| schema / mixins | `getSchemasCall`, `putSchemaCall`, `getTypesCall`, `getMixinsSchemaCall` |
| configuration | `fetchBasicConfiguration`, `fetchSingleConfiguration`, `createSingleConfiguration`, `updateSingleConfiguration`, `KEY_EXT_APPS`, `KEY_PERSPECTIVES` |
| mediaAssets | `postFileAsset(tenant, file, onProgress, refIds, access)`, `getAssetsForId`, `fetchAsset`, `downloadAsset`, `delAsset` |
| sites / countries / currencies / taxes / units / delivery / shipping | CRUD for each |
| coupons / segments / labels / brands / suppliers / vendors | CRUD for each |
| webhooks / featureToggles / changelog / statistics / invoice / sepa / picklists / paymentGateway | see `.d.ts` |
| ai | `generateTextRequest` |

## Endpoint not covered by the package

Use the shared client so auth and tenant headers stay consistent:

```ts
// src/api/<domain>.api.ts
import { getApiClient } from '@emporix/api-calls'
import type { Thing } from '../models/Thing.model'

export const fetchThings = async (tenant: string): Promise<Thing[]> => {
  const { data } = await getApiClient().get<Thing[]>(`/<service>/${tenant}/things`)
  return data
}
```

Confirm the path, query parameters and required scopes with the docs MCP
(`askQuestion` / `getPage` on the API reference) before writing the call.
