import { BufReader, readLines } from 'https://deno.land/std@0.84.0/io/bufio.ts'

export default async function* (
  filepath: string
): AsyncIterableIterator<string> {
  const file = await Deno.open(filepath, { read: true })
  try {
    const bufReader = new BufReader(file)
    for await (const line of readLines(bufReader)) {
      yield line
    }
  } finally {
    Deno.close(file.rid)
  }
}
