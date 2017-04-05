let express = require('express'), passport = require('passport')
const SCOPES = ['basic_read', 'extended_read', 'location_read', 'mood_read', 'sleep_read', 'move_read', 'meal_read', 'weight_read', 'generic_event_read', 'heartrate_read']

let app = express.Router()
let strategy = require('./strategy')
let downloader = require('./downloader.js')

downloader.startDownload()

app.get('/login/jawbone',
  passport.authorize('jawbone', {
    scope: SCOPES,
    failureRedirect: '/'
  })
)

app.get('/sleepdata',
  passport.authorize('jawbone', {
    scope: SCOPES,
    failureRedirect: '/'
  }), function (req, res) {
    res.render('userdata', req.account)
  }
)

app.get('/logout', function (req, res) {
  strategy.resetVariables()
  req.logout()
  res.redirect('/')
  downloader.getBrowser().get('https://jawbone.com/user/signin/logout_redirect')
  downloader.getBrowser().get('https://localhost:5000/')
  if (downloader.getDownloadDone() && downloader.lastUser()) {
    strategy.resetTimeBasedFilename()
    downloader.getBrowser().quit()
  }
})

app.get('/home', function (req, res) {
  strategy.getUser().setStudyId(req.query['emaId'])
  strategy.getUser().setEmail(req.query['email'])
  strategy.setUpParameters(req)
  res.render('home')
  strategy.generateCombinedSummaryFiles()
})

app.get('/', function (req, res) {
  res.render('index')
})

module.exports = { router: app }