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
    JawboneStrategy = require('passport-oauth').OAuth2Strategy,
    port = 5000,
    converter = require('json-2-csv'),
    yaml = require('js-yaml'),
    async = require("async"),
    settings = yaml.safeLoad(fs.readFileSync('config/settings.yml', 'utf8')),
    jawboneAuth = {
        clientID: settings['clientID'],
        clientSecret: settings['clientSecret'],
        authorizationURL: 'https://jawbone.com/auth/oauth2/auth',
        tokenURL: 'https://jawbone.com/auth/oauth2/token',
        callbackURL: settings['callbackURL']
    },
    sslOptions = {
        key: fs.readFileSync(settings['serverKey']),
        cert: fs.readFileSync(settings['serverCert'])
    },
    jawboneScopes = ['basic_read', 'extended_read', 'location_read',
        'mood_read', 'sleep_read', 'move_read', 'meal_read', 'weight_read',
        'generic_event_read', 'heartrate_read'
    ],
    EMA_ID, USER_EMAIL, START_DATE, END_DATE, DATA_DIR,
    BASE_DIR = settings['BASE_DIR'],
    MAX_RESULTS = 1000000,
    dataSummary = [],
    counter = 0;

expressWinston.requestWhitelist = ['url', 'method', 'originalUrl', 'query'];
var router = express.Router();
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

app.use(router);

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
        scope: jawboneScopes,
        failureRedirect: '/adaptup'
    })
);

subApp.get('/summary',
    passport.authorize('jawbone', {
        scope: jawboneScopes,
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
    if (fs.existsSync(DATA_DIR)) {
        fs.readdirSync(DATA_DIR).forEach(function(file, index) {
            delete_file(DATA_DIR + file);
        });
        fs.rmdir(DATA_DIR, function() {
            console.log(DATA_DIR + ' has been deleted');
        });
    }
}

subApp.get('/home', function(req, res) {
    EMA_ID = req.query['emaId'];
    USER_EMAIL = req.query['email'];
    if (!EMA_ID) {
        EMA_ID = new Date().getTime().toString();
    }
    setUpDataDirectory();

    var today = new Date();
    var startDate = req.query['startDate'];
    if (startDate) {
        startDate = new Date(startDate);
    } else {
        startDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    }
    START_DATE = startDate.getTime() / 1000;

    var endDate = req.query['endDate'];
    if (endDate) {
        END_DATE = new Date(endDate).getTime() / 1000;
    } else {
        END_DATE = today.getTime() / 1000;
    }

    res.render('home');
});

subApp.get('/', function(req, res) {
    res.render('index');
});

subApp.get('/download', function(req, res) {
    var zipfile = fs.createWriteStream('data/' + EMA_ID + '.zip');
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
    archive.directory(DATA_DIR);
    archive.finalize();
});

function download_file(res) {
    var file = 'data/' + EMA_ID + '.zip';
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

var authOptions = {
    clientID: jawboneAuth.clientID,
    clientSecret: jawboneAuth.clientSecret,
    authorizationURL: jawboneAuth.authorizationURL,
    tokenURL: jawboneAuth.tokenURL,
    callbackURL: jawboneAuth.callbackURL
};

var strategy = new JawboneStrategy(authOptions, function(token, refreshToken, profile, done) {
    var options = {
        access_token: token,
        client_id: jawboneAuth.clientID,
        client_secret: jawboneAuth.clientSecret
    };
    var up = require('jawbone-up')(options);
    var params = {
        start_time: START_DATE,
        end_time: END_DATE,
        limit: MAX_RESULTS
    };

    up.heartrates.get(params, function(err, body) {
        if (err) {
            console.log('Error receiving Jawbone UP data');
        } else {
            var heartRateHeaders = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'place_lon', 'place_lat', 'place_acc', 'place_name',
                'time_created', 'time_updated', 'date', 'resting_heartrate', 'details.tz', 'details.sunrise', 'details.sunset'
            ];
            var heartRates = JSON.parse(body).data.items;
            if (heartRates) {
                for (var k = 0; k < heartRates.length; k++) {
                    heartRates[k]['user_xid'] = JSON.parse(body).meta['user_xid'];
                    heartRates[k]['time_accessed'] = JSON.parse(body).meta['time'];
                    heartRates[k]['user_email'] = USER_EMAIL;
                    heartRates[k]['ema_id'] = EMA_ID;
                }
                converter.json2csv(heartRates, function(err, csv) {
                    if (err) console.log("Error converting heartrates data from json to csv");
                    fs.writeFile(DATA_DIR + 'heartrates.csv', csv, function(err) {
                        if (err) console.log("Error writing heartrates data to csv file");
                        createSummaryObjects(heartRates);
                    });
                }, {
                    KEYS: heartRateHeaders
                });
            }
        }
    });

    up.workouts.get(params, function(err, body) {
        if (err) {
            console.log('Error receiving Jawbone UP data');
        } else {
            var headers = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'type', 'sub_type', 'place_lon', 'place_lat',
                'place_acc', 'place_name', 'time_created', 'time_updated', 'time_completed', 'date', 'details.steps',
                'details.time', 'details.tz', 'details.bg_active_time', 'details.calories', 'details.bmr_calories',
                'details.bmr', 'details.bg_calories', 'details.meters', 'details.km', 'details.intensity'
            ];
            var jawboneData = JSON.parse(body).data.items;
            if (jawboneData) {
                for (var k = 0; k < jawboneData.length; k++) {
                    jawboneData[k]['user_xid'] = JSON.parse(body).meta['user_xid'];
                    jawboneData[k]['time_accessed'] = JSON.parse(body).meta['time'];
                    jawboneData[k]['user_email'] = USER_EMAIL;
                    jawboneData[k]['ema_id'] = EMA_ID;
                }
                converter.json2csv(jawboneData, function(err, csv) {
                    if (err) console.log("Error converting workouts data from json to csv");
                    fs.writeFile(DATA_DIR + 'workouts.csv', csv, function(err) {
                        if (err) console.log("Error writing workouts data to csv file");
                    });
                }, {
                    KEYS: headers
                });
            }
        }
    });

    up.moves.get(params, function(err, body) {
        if (err) {
            console.log('Error receiving Jawbone UP data');
        } else {
            var movesHeaders = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'type', 'time_created', 'time_updated', 'time_completed', 'date',
                'details.distance', 'details.km', 'details.steps', 'details.active_time', 'details.longest_active',
                'details.inactive_time', 'details.longest_idle', 'details.calories', 'details.bmr_day', 'details.bmr',
                'details.bg_calories', 'details.wo_calories', 'details.wo_time', 'details.wo_active_time', 'details.wo_count',
                'details.wo_longest', 'details.sunrise', 'details.sunset', 'details.tz'
            ];
            var movesInfo = JSON.parse(body).data.items;
            if (movesInfo) {
                for (var k = 0; k < movesInfo.length; k++) {
                    movesInfo[k]['user_xid'] = JSON.parse(body).meta['user_xid'];
                    movesInfo[k]['user_email'] = USER_EMAIL;
                    movesInfo[k]['ema_id'] = EMA_ID;
                    movesInfo[k]['time_accessed'] = JSON.parse(body).meta['time'];
                    movesInfo[k]['title'] = movesInfo[k]['title'].replace(',', '');
                    getMoveTicksData(up, movesInfo[k]['xid'], k == 0);
                }
                converter.json2csv(movesInfo, function(err, csv) {
                    if (err) console.log("Error converting moves data from json to csv");
                    fs.writeFile(DATA_DIR + 'moves.csv', csv, function(err) {
                        if (err) console.log("Error writing moves data to csv");
                        createSummaryObjects(movesInfo);
                    });
                }, {
                    KEYS: movesHeaders
                });
            }
        }
    });

    up.sleeps.get(params, function(err, body) {
        if (err) {
            console.log('Error receiving Jawbone UP data');
        } else {
            var sleepHeader = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'sub_type', 'time_created', 'time_completed',
                'date', 'place_lat', 'place_lon', 'place_acc', 'place_name', 'details.smart_alarm_fire', 'details.awake_time',
                'details.asleep_time', 'details.awakenings', 'details.rem', 'details.light', 'details.deep', 'details.awake',
                'details.duration', 'details.tz'
            ];
            var sleepInfo = JSON.parse(body).data.items;
            if (sleepInfo) {
                for (var k = 0; k < sleepInfo.length; k++) {
                    sleepInfo[k]['user_xid'] = JSON.parse(body).meta['user_xid'];
                    sleepInfo[k]['time_accessed'] = JSON.parse(body).meta['time'];
                    sleepInfo[k]['user_email'] = USER_EMAIL;
                    sleepInfo[k]['ema_id'] = EMA_ID;
                    getSleepTicksData(up, sleepInfo[k]['xid'], k == 0);
                }
                converter.json2csv(sleepInfo, function(err, csv) {
                    if (err) console.log("Error converting sleeps data from json to csv");
                    fs.writeFile(DATA_DIR + 'sleep.csv', csv, function(err) {
                        if (err) console.log("Error writing sleeps data to csv");
                        createSummaryObjects(sleepInfo, function() {
                            async.whilst(
                                function() {
                                    return counter < 3;
                                },
                                function(callback) {
                                    setTimeout(function() {
                                        callback(null, counter);
                                    }, 1000);
                                },
                                function(err, n) {
                                    if (err) console.log("Error in async task");
                                    return done(null, {
                                        items: dataSummary,
                                        user: USER_EMAIL
                                    }, console.log('Data ready!'));
                                }
                            );
                        });
                    });
                }, {
                    KEYS: sleepHeader
                });
            }
        }
    });
});

passport.use('jawbone', strategy);

function createSummaryObjects(jsonArray, dataSummaryReadyCallback) {
    jsonArray.forEach(function(entry) {
        var dailyDataJsonArray = dataSummary.filter(function(value) {
            return value.date == entry.date;
        });

        if (dailyDataJsonArray.length == 0) {
            var dailyDataJsonObject = {};
            dailyDataJsonObject.date = entry.date;
            dailyDataJsonObject.resting_heartrate = '';
            dailyDataJsonObject.step_count = '';
            dailyDataJsonObject.sleep_duration = '';
            var newDailyDataJsonObject = true;
        } else {
            dailyDataJsonObject = dailyDataJsonArray[0];
            newDailyDataJsonObject = false;
        }

        if (entry.resting_heartrate != null) {
            dailyDataJsonObject.resting_heartrate = entry.resting_heartrate;
        }
        if (entry.details.steps != null) {
            dailyDataJsonObject.step_count = entry.details.steps;
        }
        if (entry.details.duration != null) {
            dailyDataJsonObject.sleep_duration = formatSeconds(entry.details.duration);
        }

        if (newDailyDataJsonObject) {
            dataSummary.push(dailyDataJsonObject);
        }
    });

    counter++;
    if (counter == 3) { //Data summary is from three sources (hearrates, moves, and sleeps)
        dataSummary.sort(compare);
        writeSummarySheet();
    }
    typeof dataSummaryReadyCallback === 'function' && dataSummaryReadyCallback();
}

function getMoveTicksData(up, movesXID, first) {
    var ticksHeaders = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'moves_xid', 'distance', 'time_completed', 'active_time',
        'calories', 'steps', 'time', 'speed'
    ];
    fs.writeFile(DATA_DIR + 'move_ticks.csv', ticksHeaders, function(err) {
        if (err) console.log("Error writing moves data to csv file");
    });
    if (first) {
        appendNewLine(DATA_DIR + 'move_ticks.csv')
    }

    up.moves.ticks({
        xid: movesXID
    }, function(error, moveBody) {
        if (error) {
            console.log('Error receiving Jawbone UP moves data');
        } else {
            var ticksInfo = JSON.parse(moveBody).data.items;
            var ticksAccessTime = JSON.parse(moveBody).meta['time'];
            var userXID = JSON.parse(moveBody).meta['user_xid'];
            if (ticksInfo) {
                for (var j = 0; j < ticksInfo.length; j++) {
                    ticksInfo[j]['user_xid'] = userXID;
                    ticksInfo[j]['time_accessed'] = ticksAccessTime;
                    ticksInfo[j]['moves_xid'] = movesXID;
                    ticksInfo[j]['user_email'] = USER_EMAIL;
                    ticksInfo[j]['ema_id'] = EMA_ID;
                }
                converter.json2csv(ticksInfo, function(err, csv) {
                    if (err) console.log(err);
                    fs.appendFile(DATA_DIR + 'move_ticks.csv', csv, function(err) {
                        if (err) console.log("Error appending moves data to csv file");
                    });
                }, {
                    KEYS: ticksHeaders,
                    PREPEND_HEADER: false
                });
            }
        }
    });
}

function getSleepTicksData(up, sleepsXID, first) {
    var sleepTicksHeader = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'sleeps_xid', 'depth', 'time'];
    fs.writeFile(DATA_DIR + 'sleep_ticks.csv', sleepTicksHeader, function(err) {
        if (err) console.log("Error writing sleeps data to csv file");
    });
    if (first) {
        appendNewLine(DATA_DIR + 'sleep_ticks.csv')
    }

    up.sleeps.ticks({
        xid: sleepsXID
    }, function(err, body) {
        if (err) {
            console.log('Error receiving Jawbone Up sleep ticks');
        } else {
            var ticksInfo = JSON.parse(body).data.items;
            var ticksAccessTime = JSON.parse(body).meta['time'];
            var userXID = JSON.parse(body).meta['user_xid'];
            if (ticksInfo) {
                for (var j = 0; j < ticksInfo.length; j++) {
                    ticksInfo[j]['user_xid'] = userXID;
                    ticksInfo[j]['time_accessed'] = ticksAccessTime;
                    ticksInfo[j]['sleeps_xid'] = sleepsXID;
                    ticksInfo[j]['user_email'] = USER_EMAIL;
                    ticksInfo[j]['ema_id'] = EMA_ID;
                }
                converter.json2csv(ticksInfo, function(err, csv) {
                    if (err) console.log(err);
                    fs.appendFile(DATA_DIR + 'sleep_ticks.csv', csv, function(err) {
                        if (err) console.log("Error appending sleeps data to csv file");
                    });
                }, {
                    KEYS: sleepTicksHeader,
                    PREPEND_HEADER: false
                });
            }
        }
    });
}

function appendNewLine(filename) {
    fs.appendFile(filename, '\n', function(err) {
        if (err) console.log("Error appending new line to csv file");
    });
}

function setUpDataDirectory() {
    if (fs.existsSync(BASE_DIR)) {
        DATA_DIR = BASE_DIR + EMA_ID + '/';
        createDirectory(DATA_DIR);
    } else {
        DATA_DIR = 'data/' + EMA_ID + '/';
        createDirectory(DATA_DIR);
    }
}

function createDirectory(directory) {
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
    }
}

function formatSeconds(durationInSeconds) {
    var hours = Math.floor(parseInt(durationInSeconds) / 3600);
    durationInSeconds %= 3600;
    var minutes = Math.floor(parseInt(durationInSeconds) / 60);
    return hours + "h " + minutes + "m";
}

function writeSummarySheet() {
    converter.json2csv(dataSummary, function(err, csv) {
        if (err) console.log("Error converting summary json data to csv");
        fs.writeFile(DATA_DIR + 'summary.csv', csv, function(err) {
            if (err) console.log("Error writing summary data to csv file");
        });
    });
}

function compare(objA, objB) {
    if (objA.date < objB.date)
        return -1;
    else if (objA.date > objB.date)
        return 1;
    else
        return 0;
}

if (app.settings.env == 'production') {
    var http = require('http');
    http.createServer(app).listen(port, function() {
        console.log('AdaptUP ' + app.settings.env + ' server listening on ' + port);
    });
} else {
    var https = require('https');
    https.createServer(sslOptions, app).listen(port, function() {
        console.log('AdaptUP ' + app.settings.env + ' server listening on ' + port);
    });
}