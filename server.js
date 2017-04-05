let express = require('express'), app = express(), https = require('https'), fs = require('fs'), passport = require('passport'), path = require('path')

app.use(require('./routes').router)
app.use(require('body-parser').json())
app.use(express.static(path.join(__dirname, '/public')))

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, '/views'))

app.use(passport.initialize())
passport.use('jawbone', require('./strategy').jawboneStrategy)

let sslOptions = {
  key: fs.readFileSync('config/server.key'),
  cert: fs.readFileSync('config/server.crt')
}
const PORT = 5000

https.createServer(sslOptions, app).listen(PORT, function () {
  console.log('https server listening on ' + PORT)
})