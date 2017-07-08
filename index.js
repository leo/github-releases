// Native
const path = require('path')
const fs = require('fs-extra')

// Packages
const request = require('request')
const {valid} = require('semver')
const {tmpdir} = require('os')

const error = (res, code, message) => {
  res.statusCode = code
  res.end(message)
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

    const tmpDir = tmpdir()
    const versionPath = path.join(tmpDir, repo, version)
    const assetPath = path.join(versionPath, asset)

    if (fs.existsSync(assetPath)) {
      res.send('already there')
      return
    }

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

    res.end('ha')
  })
}
