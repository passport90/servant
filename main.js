#!/usr/bin/env node

const fsp = require('fs/promises')
const fs = require('fs')
const http2 = require('http2')
const mime = require('mime-types')

const { HTTP2_HEADER_PATH, HTTP2_HEADER_STATUS } = http2.constants

const main = async () => {
  const [_node, _script, dir, certFilePath, keyFilePath, port = 8443] = process.argv
  if (dir === undefined || certFilePath === undefined || keyFilePath === undefined) {
    console.error('Directory, private key, and certificate must be defined!')
    return
  }

  const indexFilePath = `${dir}/index.html`
  // Check whether directory and index.html exists
  try {
    await fsp.access(indexFilePath, fs.constants.F_OK | fs.constants.R_OK)
    if ((await fsp.lstat(indexFilePath)).isDirectory()) {
      throw new Error()
    }
  } catch (error) {
    console.error(`Cannot access ${indexFilePath}!`)
    return
  }


  const server = http2.createSecureServer({
    cert: await fsp.readFile(certFilePath),
    key: await fsp.readFile(keyFilePath),
  })

  server.on('stream', (stream, headers) => {
    const path = headers[HTTP2_HEADER_PATH]
    if (path.match(/\.\./)) { // Tries to go up the directory
      stream.respond({ [HTTP2_HEADER_STATUS]: 403 })
      stream.end()
      return
    }

    const handle = async stream => {
      try {
        const fullPath = `${dir}${path}`
        await fsp.access(fullPath, fs.constants.F_OK | fs.constants.R_OK)
        if ((await fsp.lstat(fullPath)).isDirectory()) {
          throw new Error('Forbidden to access a directory.')
        }

        const mimeType = mime.lookup(fullPath)
        if (!mimeType) {
          throw new Error()
        }
        stream.respond({ [HTTP2_HEADER_STATUS]: 200, 'Content-Type': mimeType })

        const readStream = fs.createReadStream(fullPath)
        readStream.pipe(stream)
      } catch (error) {
        const mimeType = mime.lookup(indexFilePath)
        if (!mimeType) {
          throw new Error('index.html does not exist.')
        }
        stream.respond({ [HTTP2_HEADER_STATUS]: 200, 'Content-Type': mimeType })
        const readStream = fs.createReadStream(indexFilePath)
        readStream.pipe(stream)
      }
    }

    handle(stream)
  })
  server.on('error', error => {
    if (error.code === 'ECONNRESET') {  // Ocassional econnreset
      server.listen(port)
      return
    }
    console.error(error)
  })

  server.listen(port)
}

main()

