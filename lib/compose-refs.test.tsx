import * as React from "react"
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { composeRefs, useComposedRefs } from "./compose-refs"

function Target({
  first,
  second,
}: {
  first?: React.Ref<HTMLDivElement>
  second?: React.Ref<HTMLDivElement>
}) {
  const ref = useComposedRefs(first, second)
  return <div ref={ref} />
}

describe("composed refs", () => {
  it("attaches and clears object and legacy callback refs without a cleanup", () => {
    const object = React.createRef<HTMLDivElement>()
    const callback = vi.fn()
    const ref = composeRefs(object, callback, null, undefined)
    const node = document.createElement("div")

    expect(ref(node)).toBeUndefined()
    expect(object.current).toBe(node)
    expect(callback).toHaveBeenLastCalledWith(node)
    expect(ref(null)).toBeUndefined()
    expect(object.current).toBeNull()
    expect(callback.mock.calls).toEqual([[node], [null]])
  })

  it("runs returned cleanups and nulls only refs without their own cleanup", () => {
    const object = React.createRef<HTMLDivElement>()
    const legacy = vi.fn()
    const cleanup1 = vi.fn()
    const cleanup2 = vi.fn()
    const callback1 = vi.fn(() => cleanup1)
    const callback2 = vi.fn(() => cleanup2)
    const node = document.createElement("div")
    const cleanup = composeRefs(
      callback1,
      object,
      legacy,
      callback2,
      null,
      undefined
    )(node)

    expect(object.current).toBe(node)
    expect(cleanup).toBeTypeOf("function")
    if (typeof cleanup !== "function") throw new Error("Missing ref cleanup")
    cleanup()
    expect(cleanup1).toHaveBeenCalledTimes(1)
    expect(cleanup2).toHaveBeenCalledTimes(1)
    expect(callback1.mock.calls).toEqual([[node]])
    expect(callback2.mock.calls).toEqual([[node]])
    expect(legacy.mock.calls).toEqual([[node], [null]])
    expect(object.current).toBeNull()
  })

  it.each([false, true])(
    "preserves attachment on rerender and cleans replaced refs (Strict Mode: %s)",
    (strict) => {
      const object = React.createRef<HTMLDivElement>()
      const nextObject = React.createRef<HTMLDivElement>()
      const cleanup = vi.fn()
      const nextCleanup = vi.fn()
      const callback = vi.fn<React.RefCallback<HTMLDivElement>>(() => cleanup)
      const nextCallback = vi.fn<React.RefCallback<HTMLDivElement>>(
        () => nextCleanup
      )
      const wrapper = strict ? React.StrictMode : React.Fragment
      const { rerender, unmount, container } = render(
        <Target first={object} second={callback} />,
        { wrapper }
      )
      const node = container.firstChild
      const initialSetups = strict ? 2 : 1
      const initialCleanups = strict ? 1 : 0
      expect(object.current).toBe(node)
      expect(callback).toHaveBeenCalledTimes(initialSetups)
      expect(cleanup).toHaveBeenCalledTimes(initialCleanups)

      rerender(<Target first={object} second={callback} />)
      expect(callback).toHaveBeenCalledTimes(initialSetups)
      expect(cleanup).toHaveBeenCalledTimes(initialCleanups)

      rerender(<Target first={nextObject} second={callback} />)
      expect(object.current).toBeNull()
      expect(nextObject.current).toBe(node)
      expect(cleanup).toHaveBeenCalledTimes(initialCleanups + 1)
      expect(callback).toHaveBeenCalledTimes(initialSetups + 1)

      rerender(<Target first={nextObject} second={nextCallback} />)
      expect(cleanup).toHaveBeenCalledTimes(initialCleanups + 2)
      expect(callback.mock.calls.every(([value]) => value === node)).toBe(true)
      expect(nextCallback.mock.calls).toEqual([[node]])
      expect(nextCleanup).not.toHaveBeenCalled()

      unmount()
      expect(nextCleanup).toHaveBeenCalledTimes(1)
      expect(nextObject.current).toBeNull()
    }
  )
})
