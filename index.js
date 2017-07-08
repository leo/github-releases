// Native
const path = require('path')
const fs = require('fs-extra')
const {createGzip} = require('zlib')

// Packages
const request = require('request')
const {valid} = require('semver')
const {tmpdir} = require('os')
const pipe = require('promisepipe')
const ms = require('ms')
const stream = require('send')

const error = (res, code, message) => {
  res.statusCode = code
  res.end(message)
}

const sendCached = (req, res, assetPath) => {
  const options = {
    maxAge: ms('1h') / 1000
  }

  res.setHeader('content-encoding', 'gzip')
  stream(req, assetPath, options).pipe(res)
}

module.exports = async (req, res) => {
  const parts = req.url.split('/').filter(item => item !== '')

  if (parts.length < 3) {
    error(res, 400, 'Arguments missing. Usage: /repo/version/asset-name')
    return
  }

  const repo = parts[0]
  const version = parts[1]
  const asset = parts[2]

  if (!valid(version)) {
    error(res, 400, 'Version tag is not a semver one')
    return
  }

  const tmpDir = tmpdir()

  const versionPath = path.join(tmpDir, repo, version)
  const assetPath = path.join(versionPath, asset)
  const loadingPath = assetPath + '-loading'

  if (fs.existsSync(assetPath)) {
    sendCached(req, res, assetPath)
    return
  }

  // For requests that are coming in while the file
  // is being cached, wait until it's fully saved and then respond
  if (fs.existsSync(loadingPath)) {
    fs.watch(loadingPath, (eventType, filename) => {
      if (filename !== asset) {
        return
      }

      sendCached(req, res, assetPath)
    })

    return
  }

  const url = `https://github.com/zeit/${repo}/releases/download/${version}/${asset}`
  const assetRequest = request(url)

  assetRequest.on('response', async assetResponse => {
    if (assetResponse.statusCode === 404) {
      error(res, 404, 'Release or asset not found')
      return
    }

    if (assetResponse.statusCode !== 200) {
      error(res, 500, 'Broken response from GitHub')
      return
    }

    console.log(`Caching version ${version} of ${repo} asset "${asset}"`)

    // Create the version directory if it doesn't exist
    if (!fs.existsSync(versionPath)) {
      console.log('Wrapper directory missing. Creating it...')

      try {
        await fs.ensureDir(versionPath)
      } catch (err) {
        error(res, 500, 'Not able to create wrapper directory')
        return
      }
    }

    const file = fs.createWriteStream(loadingPath)
    const gzip = createGzip()

    await pipe(assetResponse, gzip, file)
    console.log(`Finished caching version ${version} of ${repo} asset "${asset}"`)

    // Make cached file available to the public
    fs.renameSync(loadingPath, assetPath)

    // Send the cached file back to the client
    sendCached(req, res, assetPath)
  })
}
