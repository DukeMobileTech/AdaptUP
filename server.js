let express = require('express'),
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
    DATA_DIR, BASE_DATA_DIR, START_DATE, END_DATE, wideSummaryHeaders = [], longSummaryHeaders = [],
    shortSummaryHeaders,
    WAIT_TIME = 120000, MAX_RESULTS = 1000000, counter = 0, userCount = 0, moveCount = 0, sleepCount = 0, duration = 7,
    LINUX_BASE_DIR = settings['LINUX_BASE_DIR'],
    WINDOWS_BASE_DIR = settings['WINDOWS_BASE_DIR'];

app.use(bodyParser.json());
app.use(express.static(__dirname + '/public'));

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

app.use(passport.initialize());

let browser = new webdriver.Builder().usingServer().withCapabilities({'browserName': 'chrome'}).build();

let lineReader = require('line-reader');
lineReader.eachLine('config/subjects.csv', function (line, last) {
    userDetails.push(line);
    if (last) {
        downloadUserData(userDetails[0]);
        return false;
    }
});

let User = require('./user.js');

function downloadUserData(userString) {
    let userInfo = userString.split(',');
    if (userInfo[4].indexOf('/') === -1 && userInfo[4].lastIndexOf('/') === -1) {
        reason = userInfo[4];
    } else {
        reason = null;
    }
    console.log('start user download for user # ' + userCount + ' with ID ' + userInfo[0]);
    browser.get('https://localhost:5000/');
    // First page
    let idElement = browser.wait(webdriver.until.elementLocated(webdriver.By.id('emaId')), WAIT_TIME);
    idElement.clear();
    idElement.sendKeys(userInfo[0]);
    let emailElement = browser.wait(webdriver.until.elementLocated(webdriver.By.id('email')), WAIT_TIME);
    emailElement.clear();
    emailElement.sendKeys(userInfo[1]);
    let startDateElement = browser.wait(webdriver.until.elementLocated(webdriver.By.id('startDate')), WAIT_TIME);
    startDateElement.clear();
    startDateElement.sendKeys(userInfo[2]);
    let submitElement = browser.wait(webdriver.until.elementLocated(webdriver.By.id('submit')), WAIT_TIME);
    submitElement.click();
    // Second page
    let loginElement = browser.wait(webdriver.until.elementLocated(webdriver.By.id('login')), WAIT_TIME);
    loginElement.click();
    // Third page
    let jawboneEmailElement = browser.wait(webdriver.until.elementLocated(webdriver.By.id('jawbone-signin-email')), WAIT_TIME);
    jawboneEmailElement.sendKeys(userInfo[1]);
    let jawbonePasswordElement = browser.wait(webdriver.until.elementLocated(webdriver.By.id('jawbone-signin-password')), WAIT_TIME);
    jawbonePasswordElement.sendKeys(userInfo[3]);
    let signInElement = browser.wait(webdriver.until.elementLocated(webdriver.By.xpath("//button[@type='submit'][@class='form-button']")), WAIT_TIME);
    signInElement.click();
    // Fourth page
    let agreeElement = browser.wait(webdriver.until.elementLocated(webdriver.By.xpath("//button[@type='submit'][@class='form-button']")), WAIT_TIME);
    agreeElement.click();
    // Last page
    clickOnLogoutButton();
}

function clickOnLogoutButton() {
    setTimeout(function () {
        if (downloadDone && moveCount === numMoveTicks && sleepCount === numSleepTicks) {
            let logoutElement = browser.wait(webdriver.until.elementLocated(webdriver.By.id('adaptup-logout')), WAIT_TIME);
            logoutElement.click();
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
    START_DATE = startDate.getTime() / 1000;
    END_DATE = new Date(startDate.setTime(startDate.getTime() + 8 * 86400000)).getTime() / 1000;
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
    let options = {
            access_token: token,
            client_id: jawboneAuth.clientID,
            client_secret: jawboneAuth.clientSecret
        },
        up = require('jawbone-up')(options);

    up.me.get({}, function (err, body) {
        if (err) throw err;
        let userData = JSON.parse(body).data;
        user.setHeight(userData.height);
        user.setWeight(userData.weight);
        user.setGender(userData.gender ? 1 : 0); // false == 0 == male and true == 1 == female
        user.setUserId(JSON.parse(body).meta['user_xid']);
    });

    up.heartrates.get({start_time: START_DATE, end_time: END_DATE, limit: MAX_RESULTS}, function (err, body) {
        if (err) {
            console.log('Error receiving Jawbone UP data');
        } else {
            let heartRateHeaders = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'date',
                'place_lon', 'place_lat', 'place_acc', 'place_name', 'time_created', 'time_updated',
                'resting_heartrate', 'details.tz', 'details.sunrise', 'details.sunset'];
            let heartRates = JSON.parse(body).data.items;
            for (let k = 0; k < heartRates.length; k++) {
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
            let headers = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'date', 'type',
                'sub_type', 'place_lon', 'place_lat', 'place_acc', 'place_name', 'time_created', 'time_updated',
                'time_completed', 'details.steps', 'details.time', 'details.tz', 'details.bg_active_time',
                'details.calories', 'details.bmr_calories', 'details.bmr', 'details.bg_calories', 'details.meters',
                'details.km', 'details.intensity'];
            let jawboneData = JSON.parse(body).data.items;
            for (let k = 0; k < jawboneData.length; k++) {
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
            let movesHeaders = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'date', 'type',
                'time_created', 'time_updated', 'time_completed', 'details.distance', 'details.km', 'details.steps',
                'details.active_time', 'details.longest_active', 'details.inactive_time', 'details.longest_idle',
                'details.calories', 'details.bmr_day', 'details.bmr', 'details.bg_calories', 'details.wo_calories',
                'details.wo_time', 'details.wo_active_time', 'details.wo_count', 'details.wo_longest',
                'details.sunrise', 'details.sunset', 'details.tz', 'details.steps_3am'];

            let movesInfo = JSON.parse(body).data.items;
            numMoveTicks = movesInfo.length;
            for (let k = 0; k < movesInfo.length; k++) {
                movesInfo[k]['user_xid'] = JSON.parse(body).meta['user_xid'];
                movesInfo[k]['user_email'] = user.email;
                movesInfo[k]['ema_id'] = user.studyId;
                movesInfo[k]['time_accessed'] = JSON.parse(body).meta['time'];
                movesInfo[k]['title'] = movesInfo[k]['title'].replace(',', '');
                getMoveTicksData(up, movesInfo[k]['xid'], k === 0);
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
            let sleepHeader = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'date', 'sub_type',
                'time_created', 'time_completed', 'place_lat', 'place_lon', 'place_acc', 'place_name', 'details.body',
                'details.mind', 'details.smart_alarm_fire', 'details.awake_time', 'details.asleep_time',
                'details.awakenings', 'details.rem', 'details.light', 'details.sound', 'details.awake',
                'details.duration', 'details.quality', 'details.tz', 'details.sunset', 'details.sunrise'];

            let sleepInfo = JSON.parse(body).data.items;
            numSleepTicks = sleepInfo.length;
            for (let k = 0; k < sleepInfo.length; k++) {
                sleepInfo[k]['user_xid'] = JSON.parse(body).meta['user_xid'];
                sleepInfo[k]['time_accessed'] = JSON.parse(body).meta['time'];
                sleepInfo[k]['user_email'] = user.email;
                sleepInfo[k]['ema_id'] = user.studyId;
                getSleepTicksData(up, sleepInfo[k]['xid'], k === 0);
            }

            converter.json2csv(sleepInfo, function (err, csv) {
                if (err) throw err;
                fs.writeFile(DATA_DIR + 'sleep.csv', csv, function (err) {
                    if (err) throw err;
                    createSummaryObjects(sleepInfo, function () {
                        async.whilst(
                            function () {
                                return counter < 3;
                            },
                            function (callback) {
                                setTimeout(function () {
                                    callback(null, counter);
                                }, 1000);
                            },
                            function (err, n) {
                                if (err) throw err;
                                downloadDone = true;
                                return done(null, {items: dataSummary, user: user.email}, console.log('Data ready!'));
                            }
                        );
                    });
                });
            }, {KEYS: sleepHeader, CHECK_SCHEMA_DIFFERENCES: false, EMPTY_FIELD_VALUE: ''});
        }
    });
}));

function formatDate(endDate) {
    let month = endDate.getMonth().toString();
    let date = endDate.getDate().toString();
    if (month.length === 1) {
        month = '0' + month;
    }
    if (date.length === 1) {
        date = '0' + date;
    }
    return parseInt(endDate.getFullYear().toString() + month + date);
}

function createSummaryObjects(jsonArray, dataSummaryReadyCallback) {
    if (dataSummary === null) {
        dataSummary = [];
    }
    jsonArray.forEach(function (entry) {
        let dailyDataJsonArray = dataSummary.filter(function (value) {
            return value.date === entry.date;
        });
        let dailyDataJsonObject;
        let newDailyDataJsonObject;
        if (dailyDataJsonArray.length === 0) {
            dailyDataJsonObject = {};
            dailyDataJsonObject.date = entry.date;
            dailyDataJsonObject.user_email = user.email;
            dailyDataJsonObject.ema_id = user.studyId;
            dailyDataJsonObject.resting_heartrate = '';
            dailyDataJsonObject.step_count = '';
            dailyDataJsonObject.sleep_duration = '';
            newDailyDataJsonObject = true;
        } else {
            dailyDataJsonObject = dailyDataJsonArray[0];
            newDailyDataJsonObject = false;
        }

        if (entry.resting_heartrate) {
            dailyDataJsonObject.resting_heartrate = entry.resting_heartrate;
        }
        if (entry.details.steps) {
            dailyDataJsonObject.step_count = entry.details.steps;
        }
        if (entry.details.duration) {
            dailyDataJsonObject.sleep_duration = formatSeconds(
                entry.details.duration - entry.details.awake);
        }

        if (newDailyDataJsonObject) {
            dataSummary.push(dailyDataJsonObject);
        }
    });

    counter++;
    if (counter === 3) { //Data summary is from three sources (heartrates, moves, and sleeps)
        dataSummary.sort(compare);
        writeIndividualSummarySheet();
        sanitizeCombinedSummaryData(dataSummary);
    }
    typeof dataSummaryReadyCallback === 'function' && dataSummaryReadyCallback();
}

function getMoveTicksData(up, movesXID, first) {
    let ticksHeaders = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'moves_xid', 'distance', 'time_completed',
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
            let ticksInfo = JSON.parse(moveBody).data.items;
            let ticksAccessTime = JSON.parse(moveBody).meta['time'];
            let userXID = JSON.parse(moveBody).meta['user_xid'];
            for (let j = 0; j < ticksInfo.length; j++) {
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
    let sleepTicksHeader = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'sleeps_xid', 'depth', 'time'];
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
            let ticksInfo = JSON.parse(body).data.items;
            let ticksAccessTime = JSON.parse(body).meta['time'];
            let userXID = JSON.parse(body).meta['user_xid'];
            for (let j = 0; j < ticksInfo.length; j++) {
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
    createDirectory(BASE_DATA_DIR + user.studyId + '/' + timeBasedFilename + '/');
}

function setBaseDataDirectory() {
    if (settings['WINDOWS'] && fs.existsSync(WINDOWS_BASE_DIR)) {
        BASE_DATA_DIR = WINDOWS_BASE_DIR;
    } else if (fs.existsSync(LINUX_BASE_DIR)) {
        BASE_DATA_DIR = LINUX_BASE_DIR;
    } else {
        BASE_DATA_DIR = 'data/';
    }
    if (timeBasedFilename === null || timeBasedFilename === undefined) {
        timeBasedFilename = new Date().toString().replace(/\W/g, "_");
    }
    DATA_DIR = BASE_DATA_DIR + user.studyId + '/' + timeBasedFilename + '/';
}

function createDirectory(directory) {
    if (!fs.existsSync(directory)) {
        mkdirp(directory, function (err) {
            if (err) throw(err);
        });
    }
}

function formatSeconds(durationInSeconds) {
    let hours = Math.floor(parseInt(durationInSeconds) / 3600);
    durationInSeconds %= 3600;
    let minutes = Math.floor(parseInt(durationInSeconds) / 60);
    return hours + 'h ' + minutes + 'm';
}

function writeIndividualSummarySheet() {
    let summaryHeader = ['date', 'user_email', 'ema_id', 'resting_heartrate', 'step_count', 'sleep_duration'];
    fs.writeFile(DATA_DIR + 'summary.csv', summaryHeader, function (err) {
        if (err) throw err;
        converter.json2csv(dataSummary, function (err, csv) {
            if (err) throw err;
            fs.writeFile(DATA_DIR + 'summary.csv', csv, function (err) {
                if (err) throw err;
            });
        }, {KEYS: summaryHeader, EMPTY_FIELD_VALUE: ''});
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
    if (userCount === 0) {
        setBaseDataDirectory();
        createDirectory(BASE_DATA_DIR + 'summaries/');
        let base = BASE_DATA_DIR + 'summaries/' + timeBasedFilename;
        wideSummaryFile = base + 'wide.csv';
        longSummaryFile = base + 'long.csv';
        shortSummaryFile = base + 'short.csv';
        generateCombinedSummaryHeaders();
    }
}

function generateCombinedSummaryHeaders() {
    let defaultHeaders = ['study_id', 'jawbone_email', 'gender', 'gender_label', 'height', 'weight', 'study_start_date'];
    wideSummaryHeaders = wideSummaryHeaders.concat(defaultHeaders);
    let dayHeaders = [], dailyDataHeaders = [];
    for (let k = 0; k <= duration; k++) {
        dayHeaders.push(`day_${k}`);
        dailyDataHeaders = dailyDataHeaders.concat([`resting_heartrate_day_${k}`, `sleep_duration_day_${k}`, `step_count_day_${k}`]);
    }
    wideSummaryHeaders = wideSummaryHeaders.concat(dayHeaders).concat(dailyDataHeaders);
    writeHeaders(wideSummaryFile, wideSummaryHeaders);
    longSummaryHeaders = longSummaryHeaders.concat(defaultHeaders).concat(
        ['day', 'resting_heartrate', 'sleep_duration', 'step_count']);
    writeHeaders(longSummaryFile, longSummaryHeaders);
    shortSummaryHeaders = ['USERID', 'SUBJECTID', 'JAWBONEEMAIL', 'NUMSLEEPDAYS', 'NUMSTEPDAYS', 'STARTDATE', 'REASON'];
    writeHeaders(shortSummaryFile, shortSummaryHeaders);
}

function writeHeaders(filename, headers) {
    fs.writeFile(filename, headers, function (err) {
        if (err) throw err;
        appendNewLine(filename);
    });
}

function sanitizeCombinedSummaryData(summaryArray) {
    let date;
    if (summaryArray.length < 8) {
        for (let i = 0; i < 8; i++) {
            let newStartDate = new Date(JSON.parse(JSON.stringify(originalStartDate)));
            let dataDate = new Date(newStartDate.setTime(newStartDate.getTime() + i * 86400000)).toLocaleDateString().split("/");
            let month = dataDate[0], day = dataDate[1];
            if (month.length === 1) {
                month = '0' + month;
            }
            if (day.length === 1) {
                day = '0' + day;
            }
            date = parseInt(dataDate[2] + month + day);
            let dailyDataJsonArray = summaryArray.filter(function (value) {
                return value.date === date;
            });
            if (dailyDataJsonArray.length === 0) {
                let jsonObject = {};
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
    let dataRow = {};
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
    let dataRow = generateDefaultRowData();
    for (let j = 0; j < data.length; j++) {
        dataRow['day_' + j] = formatDateString(data[j]['date'].toString());
        dataRow['resting_heartrate_day_' + j] = data[j]['resting_heartrate'];
        dataRow['sleep_duration_day_' + j] = data[j]['sleep_duration'];
        dataRow['step_count_day_' + j] = data[j]['step_count'];
    }
    writeJsonToCsvFile([dataRow], wideSummaryFile, wideSummaryHeaders);
}

function writeLongFormat(data) {
    let userData = [];
    for (let j = 0; j < data.length; j++) {
        let dataRow = generateDefaultRowData();
        dataRow['day'] = formatDateString(data[j]['date'].toString());
        dataRow['resting_heartrate'] = data[j]['resting_heartrate'];
        dataRow['sleep_duration'] = data[j]['sleep_duration'];
        dataRow['step_count'] = data[j]['step_count'];
        userData.push(dataRow);
    }
    writeJsonToCsvFile(userData, longSummaryFile, longSummaryHeaders);
}

function writeShortFormat(data) {
    let sleepDays = data.filter(function (value) {
        return (value.sleep_duration !== null && value.sleep_duration !== '');
    });
    let stepDays = data.filter(function (value) {
        return (value.step_count !== null && value.step_count !== '' && value.step_count > 1);
    });
    if (user.reason !== null) {
        sleepDays = "-";
        stepDays = "-";
    } else {
        sleepDays = sleepDays.length;
        stepDays = stepDays.length;
    }
    writeJsonToCsvFile([{
        'USERID': user.userId, 'SUBJECTID': user.studyId, 'JAWBONEEMAIL': user.email,
        'NUMSLEEPDAYS': sleepDays, 'NUMSTEPDAYS': stepDays, 'STARTDATE': originalStartDate.toLocaleDateString(),
        'REASON': user.reason
    }], shortSummaryFile, shortSummaryHeaders);
}

https.createServer(sslOptions, app).listen(port, function () {
    console.log('AdaptUP server listening on ' + port);
});