import * as fs from 'fs'
import * as readline from 'readline'

export default (filepath: string): AsyncIterableIterator<string> => {
  const fileStream = fs.createReadStream(filepath)
  const rl = readline.createInterface({
    input: fileStream,
  })
  return rl[Symbol.asyncIterator]()
}
