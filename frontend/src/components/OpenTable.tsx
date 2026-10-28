/** The table editor, loaded the first time it is opened: the grid it is
 *  built on is not needed by anyone who never edits a data file. */

import { lazy, Suspense, type ComponentProps } from 'react'

const TableEditor = lazy(() => import('./TableEditor').then((module) => ({ default: module.TableEditor })))

export function OpenTable(props: ComponentProps<typeof TableEditor>) {
  return (
    <Suspense fallback={<div className="modal-backdrop" />}>
      <TableEditor {...props} />
    </Suspense>
  )
}
