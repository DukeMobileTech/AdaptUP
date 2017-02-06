var fs = require('fs')
var yaml = require('js-yaml')
var jsonToCsv = require('json-2-csv')
var asyncFun = require('async')
var JawboneStrategy = require('passport-oauth').OAuth2Strategy
var settings = yaml.safeLoad(fs.readFileSync('config/settings.yml', 'utf8'))
var jawboneAuth = {
  clientID: settings['clientID'],
  clientSecret: settings['clientSecret'],
  authorizationURL: 'https://jawbone.com/auth/oauth2/auth',
  tokenURL: 'https://jawbone.com/auth/oauth2/token',
  callbackURL: settings['callbackURL']
}
var startDate, endDate, userEmail, emaID, dataDir, up, summaryCounter, fileCounter, moveCounter, sleepCounter
var dataSummary = []
var moveIdentifiers = []
var sleepIdentifiers = []
var moveTicksData = []
var sleepTicksData = []
const HR_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed',
  'xid', 'title', 'place_lon', 'place_lat', 'place_acc', 'place_name',
  'time_created', 'time_updated', 'date', 'resting_heartrate', 'details.tz',
  'details.sunrise', 'details.sunset'
]
const WORKOUT_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed',
  'xid', 'title', 'type', 'sub_type', 'place_lon', 'place_lat', 'place_acc',
  'place_name', 'time_created', 'time_updated', 'time_completed', 'date',
  'details.steps', 'details.time', 'details.tz', 'details.bg_active_time',
  'details.calories', 'details.bmr_calories', 'details.bmr',
  'details.bg_calories', 'details.meters', 'details.km', 'details.intensity'
]
const MOVE_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed',
  'xid', 'title', 'type', 'time_created', 'time_updated', 'time_completed',
  'date', 'details.distance', 'details.km', 'details.steps',
  'details.active_time', 'details.longest_active', 'details.inactive_time',
  'details.longest_idle', 'details.calories', 'details.bmr_day', 'details.bmr',
  'details.bg_calories', 'details.wo_calories', 'details.wo_time',
  'details.wo_active_time', 'details.wo_count', 'details.wo_longest',
  'details.sunrise', 'details.sunset', 'details.tz'
]
const SLEEP_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed',
  'xid', 'title', 'sub_type', 'time_created', 'time_completed', 'date',
  'place_lat', 'place_lon', 'place_acc', 'place_name',
  'details.smart_alarm_fire', 'details.awake_time', 'details.asleep_time',
  'details.awakenings', 'details.rem', 'details.light', 'details.deep',
  'details.awake', 'details.duration', 'details.tz'
]
const MOVE_TICKS_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed',
  'distance', 'time_completed', 'active_time', 'calories', 'steps', 'time', 'speed'
]
const SLEEP_TICKS_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'depth', 'time']
const SUMMARY_HEADERS = ['date', 'resting_heartrate', 'step_count', 'sleep_duration']

exports.setStartDate = function (date) {
  startDate = date
}

exports.setEndDate = function (date) {
  endDate = date
}

exports.setUserEmail = function (email) {
  userEmail = email
}

exports.setEmaId = function (id) {
  emaID = id
}

exports.setDataDir = function (dir) {
  dataDir = dir
}

exports.jawboneStrategy = new JawboneStrategy(jawboneAuth, function (token, refreshToken, profile, done) {
  var options = {
    access_token: token,
    client_id: jawboneAuth.clientID,
    client_secret: jawboneAuth.clientSecret
  }
  up = require('jawbone-up')(options)
  var params = {
    start_time: startDate,
    end_time: endDate,
    limit: 1000000
  }
  summaryCounter = 0
  fileCounter = 0
  moveCounter = 0
  sleepCounter = 0

  up.heartrates.get(params, function (err, body) {
    parseData(HR_HEADERS, 'heartrates.csv', err, body, false)
  })

  up.workouts.get(params, function (err, body) {
    parseData(WORKOUT_HEADERS, 'workouts.csv', err, body, false)
  })

  up.moves.get(params, function (err, body) {
    parseData(MOVE_HEADERS, 'moves.csv', err, body, true)
  })

  up.sleeps.get(params, function (err, body) {
    parseData(SLEEP_HEADERS, 'sleep.csv', err, body, true)
  })

  asyncFun.whilst(
    function () {
      return fileCounter < 7
    },
    function (callback) {
      setTimeout(function () {
        callback(null, fileCounter)
      }, 1000)
    },
    function (err, n) {
      if (err) {
        console.log(new Date() + ': Async Task Error : ' + err)
      }
      return done(null, {
        items: dataSummary,
        user: userEmail
      }, console.log(new Date() + ': summary data ready!'))
    }
  )
})

function parseData (headers, file, err, body, getTicks) {
  if (err) {
    console.log(new Date() + ': Error Receiving Jawbone UP Data: ' + err)
  } else {
    var dataItems = JSON.parse(body).data.items
    if (dataItems) {
      appendExtraItems(dataItems, body, getTicks, file)
      convertAndFlush(dataItems, headers, file, true)
    }
  }
}

function appendExtraItems (dataItems, body, getTicks, filename) {
  for (var k = 0; k < dataItems.length; k++) {
    dataItems[k]['user_xid'] = JSON.parse(body).meta['user_xid']
    dataItems[k]['time_accessed'] = JSON.parse(body).meta['time']
    dataItems[k]['user_email'] = userEmail
    dataItems[k]['ema_id'] = emaID
    dataItems[k]['title'] = dataItems[k]['title'].replace(',', '')
    if (getTicks) {
      if (filename === 'moves.csv') {
        moveIdentifiers.push(dataItems[k]['xid'])
      } else if (filename === 'sleep.csv') {
        sleepIdentifiers.push(dataItems[k]['xid'])
      }
    }
  }
  getActivityTicks(filename)
}

function convertAndFlush (dataArray, headers, file, summary) {
  jsonToCsv.json2csv(dataArray, function (err, csv) {
    if (err) {
      console.log(new Date() + ': Error converting json to csv: ' + err)
    } else {
      fs.writeFile(dataDir + file, csv, function (err) {
        if (err) {
          console.log(new Date() + ': Error writing data to file: ' + err)
        } else {
          if (summary) {
            createSummaryObjects(dataArray)
          }
          fileCounter++
        }
      })
    }
  }, {
    KEYS: headers
  })
}

function getActivityTicks (filename) {
  if (filename === 'moves.csv') {
    for (var k = 0; k < moveIdentifiers.length; k++) {
      up.moves.ticks({
        xid: moveIdentifiers[k]
      }, function (error, body) {
        moveCounter++
        parseTicksData(error, body, MOVE_TICKS_HEADERS, 'move_ticks.csv', moveCounter)
      })
    }
  } else if (filename === 'sleep.csv') {
    for (var i = 0; i < sleepIdentifiers.length; i++) {
      up.sleeps.ticks({
        xid: sleepIdentifiers[i]
      }, function (error, body) {
        sleepCounter++
        parseTicksData(error, body, SLEEP_TICKS_HEADERS, 'sleep_ticks.csv', sleepCounter)
      })
    }
  }
}

function parseTicksData (err, body, headers, filename, index) {
  if (err) {
    console.log(new Date() + ': Error Receiving Jawbone UP Data: ' + err)
  } else {
    var dataItems = JSON.parse(body).data.items
    if (dataItems) {
      for (var j = 0; j < dataItems.length; j++) {
        dataItems[j]['user_xid'] = JSON.parse(body).meta['user_xid']
        dataItems[j]['time_accessed'] = JSON.parse(body).meta['time']
        dataItems[j]['user_email'] = userEmail
        dataItems[j]['ema_id'] = emaID
        if (filename === 'sleep_ticks.csv') {
          sleepTicksData.push(dataItems[j])
        } else if (filename === 'move_ticks.csv') {
          moveTicksData.push(dataItems[j])
        }
      }
      if (filename === 'sleep_ticks.csv' && index === sleepIdentifiers.length) {
        convertAndFlush(sleepTicksData, headers, filename, false)
      } else if (filename === 'move_ticks.csv' && index === moveIdentifiers.length) {
        convertAndFlush(moveTicksData, headers, filename, false)
      }
    }
  }
}

function createSummaryObjects (jsonArray) {
  jsonArray.forEach(function (entry) {
    var dailyDataJsonArray = dataSummary.filter(function (value) {
      return value.date === entry.date
    })

    if (dailyDataJsonArray.length === 0) {
      var dailyDataJsonObject = {}
      dailyDataJsonObject.date = entry.date
      dailyDataJsonObject.resting_heartrate = ''
      dailyDataJsonObject.step_count = ''
      dailyDataJsonObject.sleep_duration = ''
      var newDailyDataJsonObject = true
    } else {
      dailyDataJsonObject = dailyDataJsonArray[0]
      newDailyDataJsonObject = false
    }

    if (entry.resting_heartrate != null) {
      dailyDataJsonObject.resting_heartrate = entry.resting_heartrate
    }
    if (entry.details.steps != null) {
      dailyDataJsonObject.step_count = entry.details.steps
    }
    if (entry.details.duration != null) {
      dailyDataJsonObject.sleep_duration = formatSeconds(entry.details.duration)
    }

    if (newDailyDataJsonObject) {
      dataSummary.push(dailyDataJsonObject)
    }
  })

  summaryCounter++
  if (summaryCounter === 3) {
    dataSummary.sort(compare)
    convertAndFlush(dataSummary, SUMMARY_HEADERS, 'summary.csv', false)
  }
}

function formatSeconds (durationInSeconds) {
  var hours = Math.floor(parseInt(durationInSeconds) / 3600)
  durationInSeconds %= 3600
  var minutes = Math.floor(parseInt(durationInSeconds) / 60)
  return hours + 'h ' + minutes + 'm'
}

function compare (objA, objB) {
  if (objA.date < objB.date) {
    return -1
  } else if (objA.date > objB.date) {
    return 1
  } else {
    return 0
  }
}
