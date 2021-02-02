/**
 * Fetch and read text file line by line
 *
 * With native `fetch()` method. To be used for modern browsers or Deno to fetch remote file over HTTP(S)
 *
 * @param filepath - URL of the text file
 *
 * @returns An asynchronous iterable iterator containing each line in string from the text file
 */
export default async function* (
  filepath: string
): AsyncIterableIterator<string> {
  const utf8Decoder = new TextDecoder('utf-8')
  const res = await fetch(filepath)
  const reader = res.body.getReader()
  let { value: chunk, done: readerDone } = await reader.read()
  let chunkStr = chunk ? utf8Decoder.decode(chunk) : ''

  const re = /\r\n|\n|\r/gm
  let startIndex = 0

  for (;;) {
    const result = re.exec(chunkStr)
    if (!result) {
      if (readerDone) {
        break
      }
      const remainder = chunkStr.substr(startIndex)
      ;({ value: chunk, done: readerDone } = await reader.read())
      chunkStr = remainder + (chunkStr ? utf8Decoder.decode(chunkStr) : '')
      startIndex = re.lastIndex = 0
      continue
    }
    yield chunkStr.substring(startIndex, result.index)
    startIndex = re.lastIndex
  }
  if (startIndex < chunkStr.length) {
    // last line
    yield chunkStr.substr(startIndex)
  }
}
