import { useCallback, useRef, useState } from 'react'

/** Simple undo/redo over the complete document content. */
export function useHistory<T>(initial: T) {
  const [present, setPresent] = useState<T>(initial)
  const past = useRef<T[]>([])
  const future = useRef<T[]>([])
  const [counter, setCounter] = useState(0)

  const commit = useCallback((next: T) => {
    past.current = [...past.current.slice(-99), present]
    future.current = []
    setPresent(next)
    setCounter((value) => value + 1)
  }, [present])

  const replace = useCallback((next: T) => {
    setPresent(next)
  }, [])

  /** Take over a version updated by the server without discarding the
   *  history: saving must not interrupt undo. */
  const adopt = useCallback((next: T) => {
    setPresent(next)
    setCounter((value) => value + 1)
  }, [])

  /** Update the earlier and later states, for example when the server has
   *  assigned new ids to objects. */
  const remap = useCallback((mapper: (state: T) => T) => {
    past.current = past.current.map(mapper)
    future.current = future.current.map(mapper)
  }, [])

  const reset = useCallback((next: T) => {
    past.current = []
    future.current = []
    setPresent(next)
    setCounter((value) => value + 1)
  }, [])

  const undo = useCallback(() => {
    const previous = past.current.pop()
    if (previous === undefined) return
    future.current = [present, ...future.current]
    setPresent(previous)
    setCounter((value) => value + 1)
  }, [present])

  const redo = useCallback(() => {
    const [next, ...rest] = future.current
    if (next === undefined) return
    future.current = rest
    past.current = [...past.current, present]
    setPresent(next)
    setCounter((value) => value + 1)
  }, [present])

  return {
    present,
    commit,
    replace,
    adopt,
    remap,
    reset,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    counter,
  }
}
