let express = require('express'), app = express(), fs = require('fs'), path = require('path'), winston = require('winston'),expressWinston = require('express-winston'), bodyParser = require('body-parser'), passport = require('passport'), yaml = require('js-yaml'), routes = require('./routes')
const PORT = 5000

expressWinston.requestWhitelist = ['url', 'method', 'originalUrl', 'query']
app.use(expressWinston.logger({
  transports: [
    new winston.transports.Console({
      json: true,
      colorize: true,
      timestamp: true,
      level: 'info'
    })
  ]
}))
// router needs to go after the logger
app.use(routes.router)
// errorLogger needs to go after the router
app.use(expressWinston.errorLogger({
  transports: [
    new winston.transports.Console({
      json: true,
      colorize: true,
      timestamp: true,
      level: 'info'
    })
  ]
}))

app.use(bodyParser.json())
app.use(express.static(path.join(__dirname, '/public')))
app.use(passport.initialize())
app.use('/adaptup', routes.router)

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, '/views'))
app.get('/', function (req, res) {
  res.redirect('/adaptup')
})

passport.use('jawbone', routes.strategy.jawboneStrategy)

if (app.settings.env === 'production') {
  let http = require('http')
  http.createServer(app).listen(PORT, function () {
    console.log('AdaptUP ' + app.settings.env + ' server listening on ' + PORT)
  })
} else {
  let https = require('https')
  let settings = yaml.safeLoad(fs.readFileSync('config/settings.yml', 'utf8'))
  let sslOptions = {
    key: fs.readFileSync(settings['serverKey']),
    cert: fs.readFileSync(settings['serverCert'])
  }
  https.createServer(sslOptions, app).listen(PORT, function () {
    console.log('AdaptUP ' + app.settings.env + ' server listening on ' + PORT)
  })
}
