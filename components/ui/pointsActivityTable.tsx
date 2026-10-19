"use client"

import * as React from 'react'
import { PointsActivityDisplayData } from '@/lib/types/PointsActivity'

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'

const columnHelper = createColumnHelper<PointsActivityDisplayData>()

const columns = (accountTimeZone: string) => [
  columnHelper.accessor('description', {
    header: () => "Description",
    cell: info => info.getValue()
  }),
  columnHelper.accessor(row => row.date, {
    id: 'date',
    cell: info => info.getValue(),
    header: () => <span>Activity time ({accountTimeZone})</span>
  }),
  columnHelper.accessor('points', {
    header: () => <div style={{ textAlign: 'right' }}>Points</div>,
    cell: info => <div style={{ textAlign: 'right' }}>{info.renderValue()?.toLocaleString()}</div>
  })
]

const PointsActivityTable: React.FC<{
  accountTimeZone: string;
  activityData: PointsActivityDisplayData[];
}> = ({ accountTimeZone, activityData }) => {
  const [data, setData] = React.useState(() => [...activityData])
  const [searchQuery, setSearchQuery] = React.useState('')

  React.useEffect(() => {
    setData([...activityData])
  }, [activityData])

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filteredData = React.useMemo(() => {
    if (!normalizedQuery) {
      return data
    }
    return data.filter(row =>
      row.description.toLowerCase().includes(normalizedQuery) ||
      row.date.toLowerCase().includes(normalizedQuery) ||
      String(row.points).toLowerCase().includes(normalizedQuery)
    )
  }, [data, normalizedQuery])

  // TanStack Table returns functions that React Compiler cannot memoize safely;
  // the compiler intentionally leaves this component un-memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredData,
    columns: columns(accountTimeZone),
    getCoreRowModel: getCoreRowModel(),
  })

  const rows = table.getRowModel().rows

  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <div className="p-2">
      <h2>Recent Points Activity</h2>
      {activityData.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <input
            id="points-activity-search"
            type="search"
            aria-label="Search recent points activity"
            data-testid="points-activity-search"
            placeholder="Search description or date..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      )}
      <div
        className="points-activity-table-region"
        role="region"
        aria-label="Recent points activity"
        tabIndex={0}
      >
        <table className="points-activity-table">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 && activityData.length > 0 ? (
              <tr>
                <td colSpan={3} data-testid="points-activity-no-matches">
                  No matching points activity found.
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr key={row.id}>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
        <div className="h-4" />
      </div>
    </React.Suspense>
  )
}

export default PointsActivityTable
