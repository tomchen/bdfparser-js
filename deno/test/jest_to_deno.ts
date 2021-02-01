import { expect as _expect } from 'https://deno.land/x/expect/mod.ts'
const test = Deno.test
const describe = (desc: string, fn: () => unknown): unknown => fn()

const expect = Object.assign(_expect, {
  assertions: (n: number) => {
    // empty
  },
})

export { expect, test, describe }
