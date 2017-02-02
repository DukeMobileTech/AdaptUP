var fs = require('fs'),
    yaml = require('js-yaml'),
    jsonToCsv = require('json-2-csv'),
    asyncFun = require('async'),
    JawboneStrategy = require('passport-oauth').OAuth2Strategy;
var settings = yaml.safeLoad(fs.readFileSync('config/settings.yml', 'utf8'));
var jawboneAuth = {
    clientID: settings['clientID'],
    clientSecret: settings['clientSecret'],
    authorizationURL: 'https://jawbone.com/auth/oauth2/auth',
    tokenURL: 'https://jawbone.com/auth/oauth2/token',
    callbackURL: settings['callbackURL']
};
var startDate, endDate, userEmail, emaID, dataDir;
var counter = 0;
var dataSummary = [];

exports.setStartDate = function(date) {
    startDate = date;
}

exports.setEndDate = function(date) {
    endDate = date;
}

exports.setUserEmail = function(email) {
    userEmail = email;
}

exports.setEmaId = function(id) {
    emaID = id;
}

exports.setDataDir = function(dir) {
    dataDir = dir;
}

exports.jawboneStrategy = new JawboneStrategy(jawboneAuth, function(token, refreshToken, profile, done) {
    var options = {
        access_token: token,
        client_id: jawboneAuth.clientID,
        client_secret: jawboneAuth.clientSecret
    };
    var up = require('jawbone-up')(options);
    var params = {
        start_time: startDate,
        end_time: endDate,
        limit: 1000000
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
                    heartRates[k]['user_email'] = userEmail;
                    heartRates[k]['ema_id'] = emaID;
                }
                jsonToCsv.json2csv(heartRates, function(err, csv) {
                    if (err) console.log("Error converting heartrates data from json to csv");
                    fs.writeFile(dataDir + 'heartrates.csv', csv, function(err) {
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
                    jawboneData[k]['user_email'] = userEmail;
                    jawboneData[k]['ema_id'] = emaID;
                }
                jsonToCsv.json2csv(jawboneData, function(err, csv) {
                    if (err) console.log("Error converting workouts data from json to csv");
                    fs.writeFile(dataDir + 'workouts.csv', csv, function(err) {
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
                    movesInfo[k]['user_email'] = userEmail;
                    movesInfo[k]['ema_id'] = emaID;
                    movesInfo[k]['time_accessed'] = JSON.parse(body).meta['time'];
                    movesInfo[k]['title'] = movesInfo[k]['title'].replace(',', '');
                    getMoveTicksData(up, movesInfo[k]['xid'], k == 0);
                }
                jsonToCsv.json2csv(movesInfo, function(err, csv) {
                    if (err) console.log("Error converting moves data from json to csv");
                    fs.writeFile(dataDir + 'moves.csv', csv, function(err) {
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
                    sleepInfo[k]['user_email'] = userEmail;
                    sleepInfo[k]['ema_id'] = emaID;
                    getSleepTicksData(up, sleepInfo[k]['xid'], k == 0);
                }
                jsonToCsv.json2csv(sleepInfo, function(err, csv) {
                    if (err) console.log("Error converting sleeps data from json to csv");
                    fs.writeFile(dataDir + 'sleep.csv', csv, function(err) {
                        if (err) console.log("Error writing sleeps data to csv");
                        createSummaryObjects(sleepInfo, function() {
                            asyncFun.whilst(
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
                                        user: userEmail
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

function getMoveTicksData(up, movesXID, first) {
    var ticksHeaders = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'moves_xid', 'distance', 'time_completed', 'active_time',
        'calories', 'steps', 'time', 'speed'
    ];
    fs.writeFile(dataDir + 'move_ticks.csv', ticksHeaders, function(err) {
        if (err) console.log("Error writing moves data to csv file");
    });
    if (first) {
        appendNewLine(dataDir + 'move_ticks.csv')
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
                    ticksInfo[j]['user_email'] = userEmail;
                    ticksInfo[j]['ema_id'] = emaID;
                }
                jsonToCsv.json2csv(ticksInfo, function(err, csv) {
                    if (err) console.log(err);
                    fs.appendFile(dataDir + 'move_ticks.csv', csv, function(err) {
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
    fs.writeFile(dataDir + 'sleep_ticks.csv', sleepTicksHeader, function(err) {
        if (err) console.log("Error writing sleeps data to csv file");
    });
    if (first) {
        appendNewLine(dataDir + 'sleep_ticks.csv')
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
                    ticksInfo[j]['user_email'] = userEmail;
                    ticksInfo[j]['ema_id'] = emaID;
                }
                jsonToCsv.json2csv(ticksInfo, function(err, csv) {
                    if (err) console.log(err);
                    fs.appendFile(dataDir + 'sleep_ticks.csv', csv, function(err) {
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

function formatSeconds(durationInSeconds) {
    var hours = Math.floor(parseInt(durationInSeconds) / 3600);
    durationInSeconds %= 3600;
    var minutes = Math.floor(parseInt(durationInSeconds) / 60);
    return hours + "h " + minutes + "m";
}

function writeSummarySheet() {
    jsonToCsv.json2csv(dataSummary, function(err, csv) {
        if (err) console.log("Error converting summary json data to csv");
        fs.writeFile(dataDir + 'summary.csv', csv, function(err) {
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

function appendNewLine(filename) {
    fs.appendFile(filename, '\n', function(err) {
        if (err) console.log("Error appending new line to csv file");
    });
}