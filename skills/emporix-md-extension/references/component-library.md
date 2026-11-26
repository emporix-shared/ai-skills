# @emporix/component-library

React components (PrimeReact-based) styled like the Management Dashboard.
Import styles once at the federated entry (`RemoteComponent.tsx`) — the
template already does it:

```ts
import '@emporix/component-library/styles'
```

Verify exports of the installed version:

```bash
grep -o 'export { [^}]* }' node_modules/@emporix/component-library/dist/index.d.ts
```

## Exports (abridged — the installed `dist/index.d.ts` is the authority)

| Need | Components |
|---|---|
| Actions | `PrimaryButton` (`loading` prop), `SecondaryButton`, `BackButton`, `Menu` |
| Feedback | `ToastProvider` + `useToast()` → `showSuccess(title, msg)`, `showError(title, msg)`; `Message`, `ConfirmBox`, `Dialog`, `ProgressBar`, `ProgressSpinner`, `Skeleton`, `StatusBadge`, `Chip`, `Tooltip` |
| Forms | `InputText` (`inputId`, `label`), `InputNumber`, `QuantityStepper`, `LocalizedInput`, `Checkbox`, `InputSwitch`, `RadioButton`, `SelectButton`, `Dropdown`, `AutoComplete`, `Calendar`, `Editor` (rich text), `FileUpload`, `FieldLabel` |
| Layout | `SectionBox`, `SectionTitle`, `Tabs` (`TabItem`), `Accordion` + `AccordionTab`, `Tree` |
| Data | `DataTable` (`value`, `dataKey`, `columns`, `loading`, `paginator`, `showFilter`, `onRowClick`, filters/sort/page events), `useDataTablePagination`, `DataTableEmptyState`, `FilterMatchMode`, `PaginatedSelector`, `DateValue`, `MoneyValue` |

## Patterns

```tsx
const { showSuccess, showError } = useToast()

try {
  await saveThing(tenant, thing)
  showSuccess(t('thing.saved'), '')
} catch (err) {
  console.error(err)
  showError(t('thing.saveFailed'), err instanceof Error ? err.message : '')
  onError?.(err)
}
```

```tsx
const columns = useMemo(
  () => [
    { columnKey: 'code', field: 'code', header: t('thing.code') },
    { columnKey: 'name', header: t('thing.name'), body: (row: Thing) => getLocalizedText(row.name, language) },
  ],
  [language, t]
)
<DataTable value={rows} dataKey="id" columns={columns} loading={isLoading} onRowClick={(row) => navigate(row.id)} />
```

Server-side paging: keep `DataTablePaginationState` in component state via
`useDataTablePagination`, pass `first/rows/sortField/sortOrder` into the API
call's `PaginationProps`, and set `totalRecords` from the response.

## When to write a local component

Only for feature-specific composites (drawers, wizards, custom layouts). Check
the export list first; prop types are in `dist/index.d.ts` next to each
component.
