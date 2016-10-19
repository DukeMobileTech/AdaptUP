var express = require('express'),
    app = express(),
    ejs = require('ejs'),
    https = require('https'),
    fs = require('fs'),
    mkdirp = require('mkdirp'),
    bodyParser = require('body-parser'),
    passport = require('passport'),
    JawboneStrategy = require('passport-oauth').OAuth2Strategy,
    port = 5000,
    converter = require('json-2-csv'),
    yaml = require('js-yaml'),
    async = require('async'),
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
    dataSummary = [], userDetails = [],
    downloadDone = false,
    user, numSleepTicks, numMoveTicks, reason,
    startDate, originalStartDate, wideSummaryFile, longSummaryFile, shortSummaryFile, timeBasedFilename,
    DATA_DIR, BASE_DATA_DIR, START_DATE, END_DATE, WIDE_SUMMARY_HEADERS, LONG_SUMMARY_HEADERS, SHORT_SUMMARY_HEADERS,
    WAIT_TIME = 60000, MAX_RESULTS = 1000000, counter = 0, userCount = 0, moveCount = 0, sleepCount = 0,
    LINUX_BASE_DIR = settings['LINUX_BASE_DIR'],
    WINDOWS_BASE_DIR = settings['WINDOWS_BASE_DIR'];

app.use(bodyParser.json());
app.use(express.static(__dirname + '/public'));

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

app.use(passport.initialize());

var browser = new webdriver.Builder().usingServer().withCapabilities({'browserName': 'chrome' }).build();

var lineReader = require('line-reader');
lineReader.eachLine('config/subjects.csv', function(line, last) {
    userDetails.push(line);
    if (last) {
        downloadUserData(userDetails[0]);
        return false;
    }
});

var User = require('./user.js');

function downloadUserData(userString) {
    var userInfo = userString.split(',');
    if (userInfo[4].indexOf('/') == -1 && userInfo[4].lastIndexOf('/') == -1) {
        reason = userInfo[4];
    } else {
        reason = null;
    }
    console.log('start user download for user # ' + userCount + ' with ID ' + userInfo[0]);
    browser.get('https://localhost:5000/');
    browser.wait(function () {
        return browser.isElementPresent(webdriver.By.name('emaId'));
    }, WAIT_TIME);
    // First page
    var idElement = browser.findElement(webdriver.By.id('emaId'));
    if (idElement) {
        idElement.clear();
        idElement.sendKeys(userInfo[0]);
    }
    var emailElement = browser.findElement(webdriver.By.id('email'));
    if (emailElement) {
        emailElement.clear();
        emailElement.sendKeys(userInfo[1]);
    }
    var startDateElement = browser.findElement(webdriver.By.id('startDate'));
    if (startDateElement) {
        startDateElement.clear();
        startDateElement.sendKeys(userInfo[2]);
    }
    var submitElement = browser.findElement(webdriver.By.id('submit'));
    if (submitElement) { submitElement.click(); }
    // Second page
    var loginElement = browser.findElement(webdriver.By.id('login'));
    if (loginElement) { loginElement.click(); }
    // Third page
    var jawboneEmailElement = browser.findElement(webdriver.By.id('jawbone-signin-email'));
    if (jawboneEmailElement) { jawboneEmailElement.sendKeys(userInfo[1]); }
    var jawbonePasswordElement = browser.findElement(webdriver.By.id('jawbone-signin-password'));
    if (jawbonePasswordElement) { jawbonePasswordElement.sendKeys(userInfo[3]); }
    var signInElement = browser.findElement(webdriver.By.xpath("//button[@type='submit'][@class='form-button']"));
    if (signInElement) { signInElement.click(); }
    // Fourth page
    var agreeElement = browser.findElement(webdriver.By.xpath("//button[@type='submit'][@class='form-button']"));
    if (agreeElement) { agreeElement.click(); }
    // Last page
    clickOnLogoutButton();
}

function clickOnLogoutButton() {
    setTimeout(function() {
        if (downloadDone && moveCount == numMoveTicks && sleepCount == numSleepTicks) {
            var logoutElement = browser.findElement(webdriver.By.id('adaptup-logout'));
            if (logoutElement) { logoutElement.click(); }
            downloadDone = false;
            console.log('user download done for: ' + userCount);
            userCount++;
            if (userCount < userDetails.length) {
                downloadUserData(userDetails[userCount]);
            } else {
                downloadDone = true;
            }
        } else {
            clickOnLogoutButton();
        }
    }, 50);
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
    if (downloadDone && userCount >= userDetails.length) {
        timeBasedFilename = null;
        browser.quit();
    }
});

app.get('/home', function (req, res) {
    user = new User(req.query['emaId'], req.query['email']);
    user.setReason(reason);
    startDate = new Date(req.query['startDate']);
    originalStartDate = new Date(JSON.parse(JSON.stringify(startDate)));
    START_DATE = startDate.getTime()/1000;
    END_DATE = new Date(startDate.setTime(startDate.getTime() + 8 * 86400000)).getTime()/1000;
    res.render('home');
    generateCombinedSummaryFiles();
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
    setUpDataDirectory();
    var options = {
            access_token: token,
            client_id: jawboneAuth.clientID,
            client_secret: jawboneAuth.clientSecret
        },
        up = require('jawbone-up')(options);

    up.me.get({}, function (err, body) {
        if (err) throw err;
        var userData = JSON.parse(body).data;
        user.setHeight(userData.height);
        user.setWeight(userData.weight);
        user.setGender(userData.gender ? 1 : 0); // false == 0 == male and true == 1 == female
        user.setUserId(JSON.parse(body).meta['user_xid']);
    });

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
                heartRates[k]['user_email'] = user.email;
                heartRates[k]['ema_id'] = user.studyId;
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
                jawboneData[k]['user_email'] = user.email;
                jawboneData[k]['ema_id'] = user.studyId;
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
            numMoveTicks = movesInfo.length;
            for (var k = 0; k < movesInfo.length; k++) {
                movesInfo[k]['user_xid'] = JSON.parse(body).meta['user_xid'];
                movesInfo[k]['user_email'] = user.email;
                movesInfo[k]['ema_id'] = user.studyId;
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
            numSleepTicks = sleepInfo.length;
            for (var k = 0; k < sleepInfo.length; k++) {
                sleepInfo[k]['user_xid'] = JSON.parse(body).meta['user_xid'];
                sleepInfo[k]['time_accessed'] = JSON.parse(body).meta['time'];
                sleepInfo[k]['user_email'] = user.email;
                sleepInfo[k]['ema_id'] = user.studyId;
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
                                downloadDone = true;
                                return done(null, { items: dataSummary, user: user.email }, console.log('Data ready!'));
                            }
                        );
                    });
                });
            }, {KEYS: sleepHeader, CHECK_SCHEMA_DIFFERENCES: false, EMPTY_FIELD_VALUE: ''});
        }
    });
}));

function formatDate(endDate) {
    var month = endDate.getMonth().toString();
    var date = endDate.getDate().toString();
    if (month.length == 1) { month = '0' + month; }
    if (date.length == 1) { date = '0' + date; }
   return parseInt(endDate.getFullYear().toString() + month + date);
}

function createSummaryObjects(jsonArray, dataSummaryReadyCallback) {
    if (dataSummary == null) { dataSummary = []; }
    jsonArray.forEach(function (entry) {
        var dailyDataJsonArray = dataSummary.filter(function(value) {
            return value.date == entry.date;
        });

        if (dailyDataJsonArray.length == 0) {
            var dailyDataJsonObject = {};
            dailyDataJsonObject.date = entry.date;
            dailyDataJsonObject.user_email = user.email;
            dailyDataJsonObject.ema_id = user.studyId;
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
        writeIndividualSummarySheet();
        sanitizeCombinedSummaryData(dataSummary);
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
                ticksInfo[j]['user_email'] = user.email;
                ticksInfo[j]['ema_id'] = user.studyId;
            }
            converter.json2csv(ticksInfo, function (err, csv) {
                if (err) console.log(err);
                fs.appendFile(DATA_DIR + 'move_ticks.csv', csv, function (err) {
                    if (err) throw err;
                    moveCount++;
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
                ticksInfo[j]['user_email'] = user.email;
                ticksInfo[j]['ema_id'] = user.studyId;
            }
            converter.json2csv(ticksInfo, function (err, csv) {
                if (err) console.log(err);
                fs.appendFile(DATA_DIR + 'sleep_ticks.csv', csv, function (err) {
                    if (err) throw err;
                    sleepCount++;
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
    setBaseDataDirectory();
    createDirectory(BASE_DATA_DIR + user.studyId + '/' + timeBasedFilename  + '/');
}

function setBaseDataDirectory() {
    if (settings['WINDOWS'] && fs.existsSync(WINDOWS_BASE_DIR)) {
        BASE_DATA_DIR = WINDOWS_BASE_DIR;
    } else if(fs.existsSync(LINUX_BASE_DIR)) {
        BASE_DATA_DIR = LINUX_BASE_DIR;
    } else {
        BASE_DATA_DIR = 'data/';
    }
    if (timeBasedFilename == null) { timeBasedFilename = new Date().toString().replace(/\W/g, "_"); }
    DATA_DIR = BASE_DATA_DIR + user.studyId + '/' + timeBasedFilename  + '/';
}

function createDirectory(directory) {
    if (!fs.existsSync(directory)) {
        mkdirp(directory, function (err) {
            if (err) throw(err);
        });
    }
}

function formatSeconds(durationInSeconds) {
    var hours = Math.floor(parseInt(durationInSeconds) / 3600);
    durationInSeconds %= 3600;
    var minutes = Math.floor(parseInt(durationInSeconds) / 60);
    return hours + 'h ' + minutes + 'm';
}

function writeIndividualSummarySheet() {
    var summaryHeader = ['date', 'user_email', 'ema_id', 'resting_heartrate', 'step_count', 'sleep_duration'];
    fs.writeFile(DATA_DIR + 'summary.csv', summaryHeader, function (err) {
        if (err) throw err;
        converter.json2csv(dataSummary, function (err, csv) {
            if (err) throw err;
            fs.writeFile(DATA_DIR + 'summary.csv', csv, function (err) {
                if (err) throw err;
            });
        }, { KEYS: summaryHeader, EMPTY_FIELD_VALUE: '' });
    });
}

function compare(objA, objB) {
    return objA.date - objB.date;
}

function resetVariables() {
    counter = 0;
    user = null;
    START_DATE = null;
    END_DATE = null;
    dataSummary = null;
    startDate = null;
    originalStartDate = null;
    moveCount = 0;
    sleepCount = 0;
    numMoveTicks = null;
    numSleepTicks = null;
}

function generateCombinedSummaryFiles() {
    if (userCount == 0) {
        setBaseDataDirectory();
        createDirectory(BASE_DATA_DIR + 'summaries/');
        var base = BASE_DATA_DIR + 'summaries/' + timeBasedFilename;
        wideSummaryFile = base + 'wide.csv';
        longSummaryFile = base + 'long.csv';
        shortSummaryFile = base + 'short.csv';
        generateCombinedSummaryHeaders();
    }
}

function generateCombinedSummaryHeaders() {
    WIDE_SUMMARY_HEADERS = ['study_id', 'jawbone_email', 'gender', 'gender_label', 'height', 'weight', 'study_start_date',
        'day_0', 'day_1', 'day_2', 'day_3', 'day_4', 'day_5', 'day_6', 'day_7',
        'resting_heartrate_day_0', 'sleep_duration_day_0', 'step_count_day_0',
        'resting_heartrate_day_1', 'sleep_duration_day_1', 'step_count_day_1',
        'resting_heartrate_day_2', 'sleep_duration_day_2', 'step_count_day_2',
        'resting_heartrate_day_3', 'sleep_duration_day_3', 'step_count_day_3',
        'resting_heartrate_day_4', 'sleep_duration_day_4', 'step_count_day_4',
        'resting_heartrate_day_5', 'sleep_duration_day_5', 'step_count_day_5',
        'resting_heartrate_day_6', 'sleep_duration_day_6', 'step_count_day_6',
        'resting_heartrate_day_7', 'sleep_duration_day_7', 'step_count_day_7'];
    writeHeaders(wideSummaryFile, WIDE_SUMMARY_HEADERS);
    LONG_SUMMARY_HEADERS = ['study_id', 'jawbone_email', 'gender', 'gender_label', 'height', 'weight', 'study_start_date',
    'day', 'resting_heartrate', 'sleep_duration', 'step_count'];
    writeHeaders(longSummaryFile, LONG_SUMMARY_HEADERS);
    SHORT_SUMMARY_HEADERS = ['USERID', 'SUBJECTID', 'JAWBONEEMAIL', 'NUMSLEEPDAYS', 'NUMSTEPDAYS', 'STARTDATE', 'REASON'];
    writeHeaders(shortSummaryFile, SHORT_SUMMARY_HEADERS);
}

function writeHeaders(filename, headers) {
    fs.writeFile(filename, headers, function (err) {
        if (err) throw err;
        appendNewLine(filename);
    });
}

function sanitizeCombinedSummaryData(summaryArray) {
    var date;
    if (summaryArray.length < 8) {
        for (var i = 0; i < 8; i++) {
            var newStartDate = new Date(JSON.parse(JSON.stringify(originalStartDate)));
            var dataDate = new Date(newStartDate.setTime(newStartDate.getTime() + i * 86400000)).toLocaleDateString().split("/");
            var month = dataDate[0], day = dataDate[1];
            if (month.length == 1) { month = '0' + month; }
            if (day.length == 1) { day = '0' + day; }
            date = parseInt(dataDate[2] + month + day);
            var dailyDataJsonArray = summaryArray.filter(function(value) {
                return value.date == date;
            });
            if (dailyDataJsonArray.length == 0) {
                var jsonObject = {};
                jsonObject.date = date;
                jsonObject.user_email = user.email;
                jsonObject.ema_id = user.studyId;
                jsonObject.resting_heartrate = '';
                jsonObject.step_count = '';
                jsonObject.sleep_duration = '';
                summaryArray.push(jsonObject);
            }
        }
        summaryArray.sort(compare);
    }
    writeWideFormat(summaryArray);
    writeLongFormat(summaryArray);
    writeShortFormat(summaryArray);
}

function formatDateString(str) {
    return new Date(str.substring(0, 4), (parseInt(str.substring(4, 6)) - 1).toString(), str.substring(6)).toLocaleDateString();
}

function generateDefaultRowData() {
    var dataRow = {};
    dataRow['study_id'] = user.studyId;
    dataRow['jawbone_email'] = user.email;
    dataRow['gender'] = user.gender;
    dataRow['height'] = user.height;
    dataRow['gender_label'] = user.gender ? 'female' : 'male';
    dataRow['weight'] = user.weight;
    dataRow['study_start_date'] = originalStartDate.toLocaleDateString();
    return dataRow;
}

function writeJsonToCsvFile(dataArray, filename, headers) {
    converter.json2csv(dataArray, function (err, csv) {
        if (err) console.log(err);
        fs.appendFile(filename, csv, function (err) {
            if (err) throw err;
        });
    }, {KEYS: headers, PREPEND_HEADER: false, CHECK_SCHEMA_DIFFERENCES: false, EMPTY_FIELD_VALUE: ''});
}

function writeWideFormat(data) {
    var dataRow = generateDefaultRowData();
    for (var j = 0; j < data.length; j++) {
        dataRow['day_' + j] = formatDateString(data[j]['date'].toString());
        dataRow['resting_heartrate_day_' + j] = data[j]['resting_heartrate'];
        dataRow['sleep_duration_day_' + j] = data[j]['sleep_duration'];
        dataRow['step_count_day_' + j] = data[j]['step_count'];
    }
    writeJsonToCsvFile([dataRow], wideSummaryFile, WIDE_SUMMARY_HEADERS);
}

function writeLongFormat(data) {
    var userData = [];
    for (var j = 0; j < data.length; j++) {
        var dataRow = generateDefaultRowData();
        dataRow['day'] = formatDateString(data[j]['date'].toString());
        dataRow['resting_heartrate'] = data[j]['resting_heartrate'];
        dataRow['sleep_duration'] = data[j]['sleep_duration'];
        dataRow['step_count'] = data[j]['step_count'];
        userData.push(dataRow);
    }
    writeJsonToCsvFile(userData, longSummaryFile, LONG_SUMMARY_HEADERS);
}

function writeShortFormat(data) {
    var sleepDays = data.filter(function(value) {
        return (value.sleep_duration != null && value.sleep_duration != '');
    });
    var stepDays = data.filter(function(value) {
        return (value.step_count != null && value.step_count != '' && value.step_count > 1);
    });
    if (user.reason != null) {
        sleepDays = "-";
        stepDays = "-";
    } else {
        sleepDays = sleepDays.length;
        stepDays = stepDays.length;
    }
    writeJsonToCsvFile([{'USERID': user.userId, 'SUBJECTID': user.studyId, 'JAWBONEEMAIL': user.email,
            'NUMSLEEPDAYS': sleepDays, 'NUMSTEPDAYS': stepDays, 'STARTDATE': originalStartDate.toLocaleDateString(),
            'REASON': user.reason}], shortSummaryFile, SHORT_SUMMARY_HEADERS);
}

https.createServer(sslOptions, app).listen(port, function () {
    console.log('AdaptUP server listening on ' + port);
});