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

const columns = [
  columnHelper.accessor('description', {
    header: () => "Description",
    cell: info => info.getValue()
  }),
  columnHelper.accessor(row => row.date, {
    id: 'date',
    cell: info => info.getValue(),
    header: () => <span>Date</span>
  }),
  columnHelper.accessor('points', {
    header: () => <div style={{ textAlign: 'right' }}>Points</div>,
    cell: info => <div style={{ textAlign: 'right' }}>{info.renderValue()?.toLocaleString()}</div>
  })
]

const PointsActivityTable: React.FC<{ activityData: PointsActivityDisplayData[] }> = ({ activityData }) => {
  const [data, setData] = React.useState(() => [...activityData])

  React.useEffect(() => {
    setData([...activityData])
  }, [activityData])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <div className="p-2">
      <h2>Recent Points Activity</h2>
        <table>
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
            {table.getRowModel().rows.map(row => (
              <tr key={row.id}>
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="h-4" />
      </div>
    </React.Suspense>
  )
}

export default PointsActivityTable