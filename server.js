var express = require('express'),
    app = express(),
    ejs = require('ejs'),
    fs = require('fs'),
    winston = require('winston'),
    expressWinston = require('express-winston'),
    archiver = require('archiver'),
    path = require('path'),
    mime = require('mime'),
    bodyParser = require('body-parser'),
    passport = require('passport'),
    yaml = require('js-yaml');
var settings = yaml.safeLoad(fs.readFileSync('config/settings.yml', 'utf8'));
var scopes = ['basic_read', 'extended_read', 'location_read',
    'mood_read', 'sleep_read', 'move_read', 'meal_read', 'weight_read',
    'generic_event_read', 'heartrate_read'
];
var dataDir, emaID;
const BASE_DIR = settings['BASE_DIR'];
const PORT = 5000;

var strategy = require('./strategy');

expressWinston.requestWhitelist = ['url', 'method', 'originalUrl', 'query'];
app.use(expressWinston.logger({
    transports: [
        new winston.transports.Console({
            json: true,
            colorize: true,
            timestamp: true,
            level: 'info'
        })
    ]
}));
// router needs to go after the logger 
app.use(express.Router());
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
}));

app.use(bodyParser.json());
app.use(express.static(__dirname + '/public'));
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(passport.initialize());

var subApp = express();
subApp.use(express.static(__dirname + '/public'));

subApp.get('/login/jawbone',
    passport.authorize('jawbone', {
        scope: scopes,
        failureRedirect: '/adaptup'
    })
);

subApp.get('/summary',
    passport.authorize('jawbone', {
        scope: scopes,
        failureRedirect: '/adaptup'
    }),
    function(req, res) {
        res.render('userdata', req.account);
    }
);

subApp.get('/logout', function(req, res) {
    delete_data_folder();
    req.logout();
    res.redirect('/adaptup');
});

function delete_data_folder() {
    if (fs.existsSync(dataDir)) {
        fs.readdirSync(dataDir).forEach(function(file, index) {
            delete_file(dataDir + file);
        });
        fs.rmdir(dataDir, function() {
            console.log(dataDir + ' has been deleted');
        });
    }
}

subApp.get('/home', function(req, res) {
    emaID = req.query['emaId'];
    if (!emaID) {
        emaID = new Date().getTime().toString();
    }
    strategy.setEmaId(emaID);
    strategy.setUserEmail(req.query['email']);
    setUpDataDirectory();

    var today = new Date();
    var startDate = req.query['startDate'];
    if (startDate) {
        startDate = new Date(startDate);
    } else {
        startDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    }
    strategy.setStartDate(startDate.getTime() / 1000);

    var endDate = req.query['endDate'];
    if (endDate) {
        endDate = new Date(endDate).getTime() / 1000;
    } else {
        endDate = today.getTime() / 1000;
    }
    strategy.setEndDate(endDate);

    res.render('home');
});

subApp.get('/', function(req, res) {
    res.render('index');
});

subApp.get('/download', function(req, res) {
    var zipfile = fs.createWriteStream('data/' + emaID + '.zip');
    var archive = archiver('zip', {
        store: true
    });

    zipfile.on('close', function() {
        console.log('The zip file has been finalized and is ready for download');
        download_file(res);
    });

    zipfile.on('error', function(err) {
        console.log('Zip error: ' + err);
    });

    archive.pipe(zipfile);
    archive.directory(dataDir);
    archive.finalize();
});

function download_file(res) {
    var file = 'data/' + emaID + '.zip';
    res.setHeader('Content-disposition', 'attachment; filename=' + path.basename(file));
    res.setHeader('Content-type', mime.lookup(file));
    var filestream = fs.createReadStream(file);
    filestream.pipe(res);
    filestream.on('close', function() {
        delete_file(file);
    });
}

function delete_file(file) {
    fs.unlinkSync(file, function() {
        console.log(file + ' has been deleted');
    });
}

app.get('/', function(req, res) {
    res.redirect('/adaptup');
});

app.use('/adaptup', subApp);

passport.use('jawbone', strategy.jawboneStrategy);

function setUpDataDirectory() {
    if (fs.existsSync(BASE_DIR)) {
        dataDir = BASE_DIR + emaID + '/';
    } else {
        dataDir = 'data/' + emaID + '/';
    }
    createDirectory(dataDir);
    strategy.setDataDir(dataDir);
}

function createDirectory(directory) {
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
    }
}

if (app.settings.env == 'production') {
    var http = require('http');
    http.createServer(app).listen(PORT, function() {
        console.log('AdaptUP ' + app.settings.env + ' server listening on ' + PORT);
    });
} else {
    var https = require('https');
    var sslOptions = {
        key: fs.readFileSync(settings['serverKey']),
        cert: fs.readFileSync(settings['serverCert'])
    };
    https.createServer(sslOptions, app).listen(PORT, function() {
        console.log('AdaptUP ' + app.settings.env + ' server listening on ' + PORT);
    });
}