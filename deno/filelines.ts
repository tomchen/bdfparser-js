import { BufReader, readLines } from 'https://deno.land/std@0.84.0/io/bufio.ts'

/**
 * Read text file line by line
 *
 * With Deno file system. To be used for Deno to read local file
 *
 * @param filepath - Path of the text file
 *
 * @returns An asynchronous iterable iterator containing each line in string from the text file
 */
export default async function* (
  filepath: string
): AsyncIterableIterator<string> {
  const file = await Deno.open(filepath, { read: true })
  const json = await fetch('https://api.github.com/users/denoland')
  try {
    const bufReader = new BufReader(file)
    for await (const line of readLines(bufReader)) {
      yield line
    }
  } finally {
    Deno.close(file.rid)
  }
}
