var express = require('express')
var passport = require('passport')
var fs = require('fs')
var archiver = require('archiver')
var path = require('path')
var mime = require('mime')
var yaml = require('js-yaml')
var settings = yaml.safeLoad(fs.readFileSync('config/settings.yml', 'utf8'))
var scopes = ['basic_read', 'extended_read', 'location_read',
  'mood_read', 'sleep_read', 'move_read', 'meal_read', 'weight_read',
  'generic_event_read', 'heartrate_read'
]
var dataDir, emaID
const BASE_DIR = settings['BASE_DIR']

var strategy = require('./strategy')
var router = express.Router()
router.use(express.static(path.join(__dirname, '/public')))

router.get('/login/jawbone',
  passport.authorize('jawbone', {
    scope: scopes,
    failureRedirect: '/adaptup'
  })
)

router.get('/summary',
  passport.authorize('jawbone', {
    scope: scopes,
    failureRedirect: '/adaptup'
  }),
  function (req, res) {
    res.render('userdata', req.account)
  }
)

router.get('/logout', function (req, res) {
  deleteDataFolder()
  req.logout()
  res.redirect('/adaptup')
})

router.get('/home', function (req, res) {
  setUpParamaters(req)
  res.render('home')
})

router.get('/', function (req, res) {
  res.render('index')
})

router.get('/download', function (req, res) {
  zipDir(res)
})

function zipDir (res) {
  var zipfile = fs.createWriteStream('data/' + emaID + '.zip')
  var archive = archiver('zip', {
    store: true
  })
  zipfile.on('close', function () {
    console.log('The zip file has been finalized and is ready for download')
    downloadFile(res)
  })
  zipfile.on('error', function (err) {
    console.log('Zip error: ' + err)
  })
  archive.pipe(zipfile)
  archive.directory(dataDir)
  archive.finalize()
}

function setUpParamaters (req) {
  emaID = req.query['emaId']
  if (!emaID) {
    emaID = new Date().getTime().toString()
  }
  strategy.setEmaId(emaID)
  strategy.setUserEmail(req.query['email'])
  setUpDataDirectory()

  var today = new Date()
  var startDate = req.query['startDate']
  if (startDate) {
    startDate = new Date(startDate)
  } else {
    startDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())
  }
  strategy.setStartDate(startDate.getTime() / 1000)

  var endDate = req.query['endDate']
  if (endDate) {
    endDate = new Date(endDate).getTime() / 1000
  } else {
    endDate = today.getTime() / 1000
  }
  strategy.setEndDate(endDate)
}

function downloadFile (res) {
  var file = 'data/' + emaID + '.zip'
  res.setHeader('Content-disposition', 'attachment; filename=' + path.basename(file))
  res.setHeader('Content-type', mime.lookup(file))
  var filestream = fs.createReadStream(file)
  filestream.pipe(res)
  filestream.on('close', function () {
    deleteFile(file)
  })
}

function deleteFile (file) {
  fs.unlinkSync(file, function () {
    console.log(file + ' has been deleted')
  })
}

function deleteDataFolder () {
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir).forEach(function (file, index) {
      deleteFile(dataDir + file)
    })
    fs.rmdir(dataDir, function () {
      console.log(dataDir + ' has been deleted')
    })
  }
}

function setUpDataDirectory () {
  if (fs.existsSync(BASE_DIR)) {
    dataDir = BASE_DIR + emaID + '/'
  } else {
    dataDir = 'data/' + emaID + '/'
  }
  createDirectory(dataDir)
  strategy.setDataDir(dataDir)
}

function createDirectory (directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory)
  }
}

module.exports = {
  router: router,
  strategy: strategy
}
