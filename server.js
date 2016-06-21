var express = require('express'),
    app = express(),
    ejs = require('ejs'),
    https = require('https'),
    fs = require('fs'),
    bodyParser = require('body-parser'),
    passport = require('passport'),
    JawboneStrategy = require('passport-oauth').OAuth2Strategy,
    port = 5000,
    converter = require('json-2-csv'),
    yaml = require('js-yaml'),
    async = require("async"),
    webdriver = require('selenium-webdriver'),
    settings = yaml.safeLoad(fs.readFileSync('config/settings.yml', 'utf8')),
    jawboneAuth = {
        clientID: settings['clientID'],
        clientSecret: settings['clientSecret'],
        authorizationURL: 'https://jawbone.com/auth/oauth2/auth',
        tokenURL: 'https://jawbone.com/auth/oauth2/token',
        callbackURL: 'https://localhost:5000/sleepdata'
    },
    sslOptions = {
        key: fs.readFileSync('config/server.key'),
        cert: fs.readFileSync('config/server.crt')
    },
    jawboneScopes = ['basic_read', 'extended_read', 'location_read', 'mood_read', 'sleep_read', 'move_read',
        'meal_read', 'weight_read', 'generic_event_read', 'heartrate_read'],
    EMA_ID, USER_EMAIL, ACCESS_TOKEN, DATA_DIR, BASE_DIR = settings['BASE_DIR'], MAX_RESULTS = 1000000,
    dataSummary = [], counter = 0, START_DATE, END_DATE, userDetails = [],
    WINDOWS_BASE_DIR = settings['WINDOWS_BASE_DIR']; /** Make sure to use UNC paths when writing to a mapped network
 drive */

app.use(bodyParser.json());
app.use(express.static(__dirname + '/public'));

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

app.use(passport.initialize());

var lineReader = require('line-reader');
lineReader.eachLine('config/users.csv', function(line, last) {
    userDetails.push(line);
    if (last) {
        initiateDataDownload();
        return false;
    }
});

var browser = new webdriver.Builder().usingServer().withCapabilities({'browserName': 'chrome' }).build();

function initiateDataDownload() {
    console.log(userDetails.length);
    for (var i = 0; i < userDetails.length; i++) {
        console.log("start user download");
        downloadUserData(userDetails[i])
    }
}

function downloadUserData(userString) {
    var userInfo = userString.split(",");
    // Navigate to localhost:5000 using Selenium webdriver
    browser.get('https://localhost:5000/');
    // First page
    var idElement = browser.findElement(webdriver.By.id("emaId"));
    idElement.clear();
    idElement.sendKeys(userInfo[0]);
    var emailElement = browser.findElement(webdriver.By.id("email"));
    emailElement.clear();
    emailElement.sendKeys(userInfo[1]);
    var startDateElement = browser.findElement(webdriver.By.id("startDate"));
    startDateElement.clear();
    startDateElement.sendKeys(userInfo[2]);
    var submitElement = browser.findElement(webdriver.By.id("submit"));
    submitElement.click();
    // Second page
    var loginElement = browser.findElement(webdriver.By.id("login"));
    loginElement.click();
    // Third page
    var jawboneEmailElement = browser.findElement(webdriver.By.id("jawbone-signin-email"));
    jawboneEmailElement.sendKeys(userInfo[1]);
    var jawbonePasswordElement = browser.findElement(webdriver.By.id("jawbone-signin-password"));
    jawbonePasswordElement.sendKeys(userInfo[3]);
    var signInElement = browser.findElement(webdriver.By.xpath("//button[@type='submit'][@class='form-button']"));
    signInElement.click();
    // Fourth page
    var agreeElement = browser.findElement(webdriver.By.xpath("//button[@type='submit'][@class='form-button']"));
    agreeElement.click();
    // Last page
    var logoutElement = browser.findElement(webdriver.By.id("adaptup-logout"));
    logoutElement.click();
    console.log("user download done");
}

app.get('/login/jawbone',
    passport.authorize('jawbone', {
        scope: jawboneScopes,
        failureRedirect: '/'
    })
);

app.get('/sleepdata',
    passport.authorize('jawbone', {
        scope: jawboneScopes,
        failureRedirect: '/'
    }), function (req, res) {
        res.render('userdata', req.account);
    }
);

app.get('/logout', function (req, res) {
    resetVariables();
    req.logout();
    res.redirect('/');
    browser.get('https://jawbone.com/user/signin/logout_redirect');
    browser.get('https://localhost:5000/');
});

app.get('/home', function (req, res) {
    EMA_ID = req.query['emaId'];
    USER_EMAIL = req.query['email'];
    var startDate = new Date(req.query['startDate']);
    START_DATE = startDate.getTime()/1000;
    END_DATE = new Date(startDate.setTime(startDate.getTime() + 8 * 86400000)).getTime()/1000;
    res.render('home');
});

app.get('/', function (req, res) {
    res.render('index');
});

passport.use('jawbone', new JawboneStrategy({
    clientID: jawboneAuth.clientID,
    clientSecret: jawboneAuth.clientSecret,
    authorizationURL: jawboneAuth.authorizationURL,
    tokenURL: jawboneAuth.tokenURL,
    callbackURL: jawboneAuth.callbackURL
}, function (token, refreshToken, profile, done) {
    ACCESS_TOKEN = token;
    setUpDataDirectory();
    var options = {
            access_token: token,
            client_id: jawboneAuth.clientID,
            client_secret: jawboneAuth.clientSecret
        },
        up = require('jawbone-up')(options);

    up.heartrates.get({start_time: START_DATE, end_time: END_DATE, limit: MAX_RESULTS}, function (err, body) {
        if (err) {
            console.log('Error receiving Jawbone UP data');
        } else {
            var heartRateHeaders = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'date',
                'place_lon', 'place_lat', 'place_acc', 'place_name', 'time_created', 'time_updated',
                'resting_heartrate', 'details.tz', 'details.sunrise', 'details.sunset'];
            var heartRates = JSON.parse(body).data.items;
            for (var k = 0; k < heartRates.length; k++) {
                heartRates[k]['user_xid'] = JSON.parse(body).meta['user_xid'];
                heartRates[k]['time_accessed'] = JSON.parse(body).meta['time'];
                heartRates[k]['user_email'] = USER_EMAIL;
                heartRates[k]['ema_id'] = EMA_ID;
            }
            converter.json2csv(heartRates, function (err, csv) {
                if (err) throw err;
                fs.writeFile(DATA_DIR + 'heartrates.csv', csv, function (err) {
                    if (err) throw err;
                    createSummaryObjects(heartRates);
                });
            }, {KEYS: heartRateHeaders, CHECK_SCHEMA_DIFFERENCES: false, EMPTY_FIELD_VALUE: ''});
        }
    });

    up.workouts.get({start_time: START_DATE, end_time: END_DATE, limit: MAX_RESULTS}, function (err, body) {
        if (err) {
            console.log('Error receiving Jawbone UP data');
        } else {
            var headers = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'date', 'type',
                'sub_type', 'place_lon', 'place_lat', 'place_acc', 'place_name', 'time_created', 'time_updated',
                'time_completed', 'details.steps', 'details.time', 'details.tz', 'details.bg_active_time',
                'details.calories', 'details.bmr_calories', 'details.bmr', 'details.bg_calories', 'details.meters',
                'details.km', 'details.intensity'];
            var jawboneData = JSON.parse(body).data.items;
            for (var k = 0; k < jawboneData.length; k++) {
                jawboneData[k]['user_xid'] = JSON.parse(body).meta['user_xid'];
                jawboneData[k]['time_accessed'] = JSON.parse(body).meta['time'];
                jawboneData[k]['user_email'] = USER_EMAIL;
                jawboneData[k]['ema_id'] = EMA_ID;
            }
            converter.json2csv(jawboneData, function (err, csv) {
                if (err) throw err;
                fs.writeFile(DATA_DIR + 'workouts.csv', csv, function (err) {
                    if (err) throw err;
                });
            }, {KEYS: headers, CHECK_SCHEMA_DIFFERENCES: false, EMPTY_FIELD_VALUE: ''});
        }
    });

    up.moves.get({start_time: START_DATE, end_time: END_DATE, limit: MAX_RESULTS}, function (err, body) {
        if (err) {
            console.log('Error receiving Jawbone UP data');
        } else {
            var movesHeaders = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'date', 'type',
                'time_created', 'time_updated', 'time_completed', 'details.distance', 'details.km', 'details.steps',
                'details.active_time', 'details.longest_active', 'details.inactive_time', 'details.longest_idle',
                'details.calories', 'details.bmr_day', 'details.bmr', 'details.bg_calories', 'details.wo_calories',
                'details.wo_time', 'details.wo_active_time', 'details.wo_count', 'details.wo_longest',
                'details.sunrise', 'details.sunset', 'details.tz', 'details.steps_3am'];

            var movesInfo = JSON.parse(body).data.items;
            for (var k = 0; k < movesInfo.length; k++) {
                movesInfo[k]['user_xid'] = JSON.parse(body).meta['user_xid'];
                movesInfo[k]['user_email'] = USER_EMAIL;
                movesInfo[k]['ema_id'] = EMA_ID;
                movesInfo[k]['time_accessed'] = JSON.parse(body).meta['time'];
                movesInfo[k]['title'] = movesInfo[k]['title'].replace(',', '');
                getMoveTicksData(up, movesInfo[k]['xid'], k == 0);
            }

            converter.json2csv(movesInfo, function (err, csv) {
                if (err) throw err;
                fs.writeFile(DATA_DIR + 'moves.csv', csv, function (err) {
                    if (err) throw err;
                    createSummaryObjects(movesInfo);
                });
            }, {KEYS: movesHeaders, CHECK_SCHEMA_DIFFERENCES: false, EMPTY_FIELD_VALUE: ''});
        }
    });

    up.sleeps.get({start_time: START_DATE, end_time: END_DATE, limit: MAX_RESULTS}, function (err, body) {
        if (err) {
            console.log('Error receiving Jawbone UP data');
        } else {
            var sleepHeader = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'date', 'sub_type',
                'time_created', 'time_completed', 'place_lat', 'place_lon', 'place_acc', 'place_name', 'details.body',
                'details.mind', 'details.smart_alarm_fire', 'details.awake_time', 'details.asleep_time',
                'details.awakenings', 'details.rem', 'details.light', 'details.sound', 'details.awake',
                'details.duration', 'details.quality', 'details.tz', 'details.sunset', 'details.sunrise'];

            var sleepInfo = JSON.parse(body).data.items;
            for (var k = 0; k < sleepInfo.length; k++) {
                sleepInfo[k]['user_xid'] = JSON.parse(body).meta['user_xid'];
                sleepInfo[k]['time_accessed'] = JSON.parse(body).meta['time'];
                sleepInfo[k]['user_email'] = USER_EMAIL;
                sleepInfo[k]['ema_id'] = EMA_ID;
                getSleepTicksData(up, sleepInfo[k]['xid'], k == 0);
            }

            converter.json2csv(sleepInfo, function (err, csv) {
                if (err) throw err;
                fs.writeFile(DATA_DIR + 'sleep.csv', csv, function (err) {
                    if (err) throw err;
                    createSummaryObjects(sleepInfo, function() {
                        async.whilst(
                            function () { return counter < 3; },
                            function (callback) {
                                setTimeout(function () {
                                    callback(null, counter);
                                }, 1000);
                            },
                            function (err, n) {
                                if (err) throw err;
                                return done(null, { items: dataSummary, user: USER_EMAIL }, console.log('Data ready!'));
                            }
                        );
                    });
                });
            }, {KEYS: sleepHeader, CHECK_SCHEMA_DIFFERENCES: false, EMPTY_FIELD_VALUE: ''});
        }
    });
}));

function createSummaryObjects(jsonArray, dataSummaryReadyCallback) {
    if (dataSummary == null) dataSummary = [];
    jsonArray.forEach(function (entry) {
        var dailyDataJsonArray = dataSummary.filter(function(value) {
            return value.date == entry.date;
        });

        if (dailyDataJsonArray.length == 0) {
            var dailyDataJsonObject = {};
            dailyDataJsonObject.date = entry.date;
            dailyDataJsonObject.user_email = USER_EMAIL;
            dailyDataJsonObject.ema_id = EMA_ID;
            dailyDataJsonObject.resting_heartrate = '';
            dailyDataJsonObject.step_count = '';
            dailyDataJsonObject.sleep_duration = '';
            var newDailyDataJsonObject = true;
        } else {
            dailyDataJsonObject = dailyDataJsonArray[0];
            newDailyDataJsonObject = false;
        }

        if (entry.resting_heartrate != null) { dailyDataJsonObject.resting_heartrate = entry.resting_heartrate; }
        if (entry.details.steps != null) { dailyDataJsonObject.step_count = entry.details.steps; }
        if (entry.details.duration != null) { dailyDataJsonObject.sleep_duration = formatSeconds(
            entry.details.duration - entry.details.awake);}

        if (newDailyDataJsonObject) { dataSummary.push(dailyDataJsonObject); }
    });

    counter++;
    if (counter == 3) { //Data summary is from three sources (hearrates, moves, and sleeps)
        dataSummary.sort(compare);
        writeSummarySheet();
    }
    typeof dataSummaryReadyCallback === 'function' && dataSummaryReadyCallback();
}

function getMoveTicksData(up, movesXID, first) {
    var ticksHeaders = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'moves_xid', 'distance', 'time_completed',
        'active_time', 'calories', 'steps', 'time', 'speed'];
    fs.writeFile(DATA_DIR + 'move_ticks.csv', ticksHeaders, function (err) {
        if (err) throw err;
    });
    if (first) {
        appendNewLine(DATA_DIR + 'move_ticks.csv')
    }

    up.moves.ticks({xid: movesXID}, function (error, moveBody) {
        if (error) {
            console.log('Error receiving Jawbone UP moves data');
        } else {
            var ticksInfo = JSON.parse(moveBody).data.items;
            var ticksAccessTime = JSON.parse(moveBody).meta['time'];
            var userXID = JSON.parse(moveBody).meta['user_xid'];
            for (var j = 0; j < ticksInfo.length; j++) {
                ticksInfo[j]['user_xid'] = userXID;
                ticksInfo[j]['time_accessed'] = ticksAccessTime;
                ticksInfo[j]['moves_xid'] = movesXID;
                ticksInfo[j]['user_email'] = USER_EMAIL;
                ticksInfo[j]['ema_id'] = EMA_ID;
            }
            converter.json2csv(ticksInfo, function (err, csv) {
                if (err) console.log(err);
                fs.appendFile(DATA_DIR + 'move_ticks.csv', csv, function (err) {
                    if (err) throw err;
                });
            }, {KEYS: ticksHeaders, PREPEND_HEADER: false, CHECK_SCHEMA_DIFFERENCES: false, EMPTY_FIELD_VALUE: ''});
        }
    });
}

function getSleepTicksData(up, sleepsXID, first) {
    var sleepTicksHeader = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'sleeps_xid', 'depth', 'time'];
    fs.writeFile(DATA_DIR + 'sleep_ticks.csv', sleepTicksHeader, function (err) {
        if (err) throw err;
    });
    if (first) {
        appendNewLine(DATA_DIR + 'sleep_ticks.csv')
    }

    up.sleeps.ticks({xid: sleepsXID}, function (err, body) {
        if (err) {
            console.log('Error receiving Jawbone Up sleep ticks');
        } else {
            var ticksInfo = JSON.parse(body).data.items;
            var ticksAccessTime = JSON.parse(body).meta['time'];
            var userXID = JSON.parse(body).meta['user_xid'];
            for (var j = 0; j < ticksInfo.length; j++) {
                ticksInfo[j]['user_xid'] = userXID;
                ticksInfo[j]['time_accessed'] = ticksAccessTime;
                ticksInfo[j]['sleeps_xid'] = sleepsXID;
                ticksInfo[j]['user_email'] = USER_EMAIL;
                ticksInfo[j]['ema_id'] = EMA_ID;
            }
            converter.json2csv(ticksInfo, function (err, csv) {
                if (err) console.log(err);
                fs.appendFile(DATA_DIR + 'sleep_ticks.csv', csv, function (err) {
                    if (err) throw err;
                });
            }, {KEYS: sleepTicksHeader, PREPEND_HEADER: false, CHECK_SCHEMA_DIFFERENCES: false, EMPTY_FIELD_VALUE: ''});
        }
    });
}

function appendNewLine(filename) {
    fs.appendFile(filename, '\n', function (err) {
        if (err) throw err;
    });
}

function setUpDataDirectory() {
    if (settings['WINDOWS'] && fs.existsSync(WINDOWS_BASE_DIR)) {
        DATA_DIR = WINDOWS_BASE_DIR + EMA_ID + '/';
        createDirectory(DATA_DIR);
    } else if(fs.existsSync(BASE_DIR)) {
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
    converter.json2csv(dataSummary, function (err, csv) {
        if (err) throw err;
        fs.writeFile(DATA_DIR + 'summary.csv', csv, function (err) {
            if (err) throw err;
        });
    });
}

function compare(objA, objB) {
    return objA.date - objB.date;
}

function resetVariables() {
    counter = 0;
    EMA_ID = null;
    USER_EMAIL = null;
    dataSummary = null;
}

https.createServer(sslOptions, app).listen(port, function () {
    console.log('AdaptUP server listening on ' + port);
});