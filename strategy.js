let fs = require('fs')
let yaml = require('js-yaml')
let jsonToCsv = require('json-2-csv')
let asyncFun = require('async')
let mkDirP = require('mkdirp')
let JawboneStrategy = require('passport-oauth').OAuth2Strategy
let settings = yaml.safeLoad(fs.readFileSync('config/settings.yml', 'utf8'))
let jawboneAuth = {
  clientID: settings['clientID'],
  clientSecret: settings['clientSecret'],
  authorizationURL: 'https://jawbone.com/auth/oauth2/auth',
  tokenURL: 'https://jawbone.com/auth/oauth2/token',
  callbackURL: settings['callbackURL']
}
let startDate, endDate, userEmail, emaID, dataDir, up, summaryCounter, fileCounter, moveCounter, sleepCounter,
  timeBasedFilename, wideSummaryFile, longSummaryFile, shortSummaryFile, baseDataDir, originalStartDate
let dataSummary = [], moveIdentifiers = [], sleepIdentifiers = [], moveTicksData = [], sleepTicksData = [],
  wideSummaryHeaders = [], longSummaryHeaders = []
const LINUX_BASE_DIR = settings['LINUX_BASE_DIR'], WINDOWS_BASE_DIR = settings['WINDOWS_BASE_DIR']
const HR_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'place_lon', 'place_lat', 'place_acc', 'place_name', 'time_created', 'time_updated', 'date', 'resting_heartrate', 'details.tz', 'details.sunrise', 'details.sunset']
const WORKOUT_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'sub_type', 'place_lon', 'place_lat', 'place_acc', 'place_name', 'time_created', 'time_updated', 'time_completed', 'date', 'reaction', 'route', 'image', 'details.steps', 'details.time', 'details.tz', 'details.bg_active_time', 'details.calories', 'details.bmr_calories', 'details.bmr', 'details.bg_calories', 'details.meters', 'details.km', 'details.intensity']
const MOVE_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'type', 'time_created', 'time_updated', 'time_completed', 'date', 'details.distance', 'details.km', 'details.steps', 'details.steps_3am', 'details.active_time', 'details.longest_active', 'details.inactive_time', 'details.longest_idle', 'details.calories', 'details.bmr_day', 'details.bmr', 'details.bg_calories', 'details.wo_calories', 'details.wo_time', 'details.wo_active_time', 'details.wo_count', 'details.wo_longest', 'details.sunrise', 'details.sunset', 'details.tz']
const SLEEP_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'xid', 'title', 'sub_type', 'time_created', 'time_updated', 'time_completed', 'date', 'place_lat', 'place_lon', 'place_acc', 'place_name', 'details.smart_alarm_fire', 'details.awake_time', 'details.asleep_time', 'details.awakenings', 'details.rem', 'details.light', 'details.sound', 'details.awake', 'details.duration', 'details.tz', 'details.body', 'details.mind', 'details.quality', 'details.sunset', 'details.sunrise']
const BODY_EVENTS_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'date', 'xid', 'title', 'type', 'time_created', 'time_updated', 'date', 'place_lat', 'place_lon', 'place_acc', 'place_name', 'note', 'lean_mass', 'weight', 'body_fat', 'bmi', 'image', 'waistline', 'details.tz']
const TRENDS_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'title', 'e_protein', 'weight', 'goal_body_weight_intent', 'body_fat', 'm_distance', 's_awakenings', 'height', 'm_lcat', 'goal_body_weight', 's_quality', 'e_calories', 'e_cholesterol', 's_light', 'e_sat_fat', 'n_bedtime', 'm_workout_time', 'e_calcium', 's_bedtime', 'n_awakenings', 'n_light', 's_awake_time', 's_sound', 'pal', 'n_duration', 'm_lcit', 'm_active_time', 'e_unsat_fat', 'm_calories', 'rhr', 'bmr', 'm_total_calories', 'n_sound', 'e_sugar', 'e_sodium', 's_awake', 's_asleep_time', 's_duration', 'n_awake', 'age', 'e_carbs', 'e_fiber', 'm_steps', 'n_quality', 'n_awake_time', 'gender', 'n_asleep_time']
const MOVE_TICKS_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'distance', 'time_completed', 'active_time', 'calories', 'steps', 'time', 'speed']
const SLEEP_TICKS_HEADERS = ['user_xid', 'user_email', 'ema_id', 'time_accessed', 'depth', 'time']
const SUMMARY_HEADERS = ['date', 'user_email', 'ema_id', 'resting_heartrate', 'step_count', 'sleep_duration']
const SHORT_SUMMARY_HEADERS = ['USERID', 'SUBJECTID', 'JAWBONEEMAIL', 'NUMSLEEPDAYS', 'NUMSTEPDAYS', 'STARTDATE', 'REASON']
const NUM_FILES_TO_WRITE = 12, WAIT_TIME = 2000, DURATION = 7

let downloader = require('./downloader.js')

let User = require('./user.js')
let user = new User()

exports.getUser = () => {
  return user
}

exports.setUser = (u) => {
  user = u
}

exports.jawboneStrategy = new JawboneStrategy(jawboneAuth, function (token, refreshToken, profile, done) {
  let options = {
    access_token: token,
    client_id: jawboneAuth.clientID,
    client_secret: jawboneAuth.clientSecret
  }
  up = require('jawbone-up')(options)
  let params = {
    start_time: startDate,
    end_time: endDate,
    limit: 1000000
  }

  summaryCounter = 0
  fileCounter = 0
  moveCounter = 0
  sleepCounter = 0

  up.me.get({}, function (err, body) {
    if (err) { console.log(new Date() + 'Error : ' + err) }
    setUserDetails(JSON.parse(body))
  })

  up.events.body.get({}, function (err, body) {
    parseData(BODY_EVENTS_HEADERS, 'body_events.csv', err, body, false)
  })

  up.trends.get(trendParams(), function (err, body) {
    parseData(TRENDS_HEADERS, 'trends.csv', err, body, false)
  })

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
      return fileCounter < NUM_FILES_TO_WRITE
    },
    function (callback) {
      setTimeout(function () {
        callback(null, fileCounter)
      }, WAIT_TIME)
    },
    function (err, n) {
      if (err) {
        console.log(new Date() + ': Async Task Error : ' + err)
      }
      downloader.setDownloadDone(true)
      return done(null, {
        items: dataSummary,
        user: userEmail
      }, console.log(new Date() + ': summary data ready!'))
    }
  )
})

function trendParams () {
  let lastDay = new Date(endDate * 1000)
  let trendEndDate = parseInt(lastDay.getFullYear() + appendZero(lastDay.getMonth() + 1) + appendZero(lastDay.getDate()))
  return {end_date: trendEndDate, bucket_size: 'd', num_buckets: DURATION}
}

function setUserDetails (json) {
  let userData = json.data
  user.setHeight(userData.height)
  user.setWeight(userData.weight)
  user.setGender(userData.gender ? 1 : 0) // false === 0 === male and true === 1 === female
  user.setUserId(json.meta['user_xid'])
}

exports.setUpParameters = function (req) {
  emaID = req.query['emaId']
  if (!emaID) {
    emaID = new Date().getTime().toString()
  }
  userEmail = req.query['email']
  setUpDataDirectory()

  let today = new Date()
  let beginDate = req.query['startDate']
  if (beginDate) {
    beginDate = new Date(beginDate)
  } else {
    beginDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())
  }
  startDate = beginDate.getTime() / 1000
  originalStartDate = new Date(JSON.parse(JSON.stringify(beginDate)))

  let lastDate = req.query['endDate']
  if (lastDate) {
    endDate = new Date(lastDate).getTime() / 1000
  } else {
    endDate = new Date(beginDate.setTime(beginDate.getTime() + DURATION * 86400000)).getTime() / 1000
  }
}

exports.generateCombinedSummaryFiles = function () {
  if (downloader.getUserCount() === 0) {
    setBaseDataDirectory()
    createDirectory(baseDataDir + 'summaries/')
    let base = baseDataDir + 'summaries/' + timeBasedFilename
    wideSummaryFile = base + 'wide.csv'
    longSummaryFile = base + 'long.csv'
    shortSummaryFile = base + 'short.csv'
    generateCombinedSummaryHeaders()
  }
}

exports.resetVariables = () => {
  user = new User()
  dataSummary = []
  moveIdentifiers = []
  sleepIdentifiers = []
  moveTicksData = []
  sleepTicksData = []
  startDate = null
  originalStartDate = null
  endDate = null
  summaryCounter = 0
  fileCounter = 0
  moveCounter = 0
  sleepCounter = 0
}

exports.resetTimeBasedFilename = () => {
  timeBasedFilename = null
}

function generateCombinedSummaryHeaders () {
  let defaultHeaders = ['study_id', 'jawbone_email', 'gender', 'gender_label', 'height', 'weight', 'study_start_date']
  wideSummaryHeaders = wideSummaryHeaders.concat(defaultHeaders)
  let dayHeaders = [], dailyDataHeaders = []
  for (let k = 0; k <= DURATION; k++) {
    dayHeaders.push(`day_${k}`)
    dailyDataHeaders = dailyDataHeaders.concat([`resting_heartrate_day_${k}`, `sleep_duration_day_${k}`, `step_count_day_${k}`])
  }
  wideSummaryHeaders = wideSummaryHeaders.concat(dayHeaders).concat(dailyDataHeaders)
  writeHeaders(wideSummaryFile, wideSummaryHeaders)
  longSummaryHeaders = longSummaryHeaders.concat(defaultHeaders).concat(
    ['day', 'resting_heartrate', 'sleep_duration', 'step_count'])
  writeHeaders(longSummaryFile, longSummaryHeaders)
  writeHeaders(shortSummaryFile, SHORT_SUMMARY_HEADERS)
}

function writeHeaders (filename, headers) {
  fs.writeFile(filename, headers, function (err) {
    if (err) throw err
    appendNewLine(filename)
  })
}

function appendNewLine (filename) {
  fs.appendFile(filename, '\n', function (err) {
    if (err) throw err
  })
}

function setUpDataDirectory () {
  setBaseDataDirectory()
  createDirectory(baseDataDir + user.studyId + '/' + timeBasedFilename + '/')
}

function setBaseDataDirectory () {
  if (settings['WINDOWS'] && fs.existsSync(WINDOWS_BASE_DIR)) {
    baseDataDir = WINDOWS_BASE_DIR
  } else if (fs.existsSync(LINUX_BASE_DIR)) {
    baseDataDir = LINUX_BASE_DIR
  } else {
    baseDataDir = 'data/'
  }
  if (timeBasedFilename === null || timeBasedFilename === undefined) {
    timeBasedFilename = new Date().toString().replace(/\W/g, '_')
  }
  dataDir = baseDataDir + user.studyId + '/' + timeBasedFilename + '/'
}

function createDirectory (directory) {
  if (!fs.existsSync(directory)) {
    mkDirP(directory, function (err) {
      if (err) throw(err)
    })
  }
}

function parseData (headers, file, err, body, getTicks) {
  if (err) {
    console.log(new Date() + ': Error Receiving Jawbone UP Data: ' + err)
  } else {
    if (file === 'trends.csv') {
      parseTrendsData(body, headers, file, getTicks)
    } else {
      let dataItems = JSON.parse(body).data.items
      if (dataItems) {
        appendExtraItems(dataItems, body, getTicks, file)
        convertAndFlush(dataItems, headers, file, true)
      }
    }
  }
}

function parseTrendsData (body, headers, file, getTicks) {
  let results = JSON.parse(body).data.data
  if (results) {
    let dataItems = []
    for (let k = 0; k < results.length; k++) {
      let trend = {}
      trend = results[k][1]
      trend.title = results[k][0]
      dataItems.push(trend)
      appendExtraItems(dataItems, body, getTicks, file)
      convertAndFlush(dataItems, headers, file, false)
    }
  }
}

function appendExtraItems (dataItems, body, getTicks, filename) {
  for (let k = 0; k < dataItems.length; k++) {
    dataItems[k]['user_xid'] = JSON.parse(body).meta['user_xid']
    dataItems[k]['time_accessed'] = JSON.parse(body).meta['time']
    dataItems[k]['user_email'] = userEmail
    dataItems[k]['ema_id'] = emaID
    if (dataItems[k]['title'] !== null && typeof dataItems[k]['title'] === 'string') {
      dataItems[k]['title'] = (dataItems[k]['title']).replace(',', '')
    }
    if (getTicks) {
      if (filename === 'moves.csv') {
        moveIdentifiers.push(dataItems[k]['xid'])
      } else if (filename === 'sleep.csv') {
        sleepIdentifiers.push(dataItems[k]['xid'])
      }
      if (k === dataItems.length - 1) {
        getActivityTicks(filename)
      }
    }
  }
  if (dataItems.length === 0) {
    getActivityTicks(filename)
  }
}

function convertAndFlush (dataArray, headers, file, summary) {
  if (file === 'summary.csv') {
    fs.writeFile(dataDir + file, headers, function (err) {
      if (err) {
        console.log(new Date() + ': Error writing data to ' + file + ' ' + err)
      } else {
        writeToFile(dataArray, headers, dataDir + file, summary, true)
      }
    })
  } else {
    writeToFile(dataArray, headers, dataDir + file, summary, true)
  }
}

function writeToFile (dataArray, headers, file, summary, prependHeader) {
  jsonToCsv.json2csv(dataArray, function (err, csv) {
    if (err) {
      console.log(new Date() + ': Error converting json to csv: ' + err)
    } else {
      if (prependHeader === false) {
        fs.appendFile(file, csv, function (err) {
          if (err) console.log(new Date() + ': Error writing data to ' + file + ' ' + err)
          fileCounter++
        })
      } else {
        fs.writeFile(file, csv, function (err) {
          if (err) console.log(new Date() + ': Error writing data to file: ' + err)
          if (summary === true && isSummarized(file) === true) {
            createSummaryObjects(dataArray)
          }
          fileCounter++
        })
      }
    }
  }, {keys: headers, prependHeader: prependHeader, checkSchemaDifferences: false, emptyFieldValue: ''})
}

function isSummarized (file) {
  return (file.split('/').pop() === 'heartrates.csv' || file.split('/').pop() === 'moves.csv' || file.split('/').pop() === 'sleep.csv')
}

function getActivityTicks (filename) {
  if (filename === 'moves.csv') {
    for (let k = 0; k < moveIdentifiers.length; k++) {
      up.moves.ticks({
        xid: moveIdentifiers[k]
      }, function (error, body) {
        moveCounter++
        parseTicksData(error, body, MOVE_TICKS_HEADERS, 'move_ticks.csv', moveCounter)
      })
    }
    if (moveIdentifiers.length === 0) {
      convertAndFlush(moveTicksData, MOVE_TICKS_HEADERS, 'move_ticks.csv', false)
    }
  } else if (filename === 'sleep.csv') {
    for (let i = 0; i < sleepIdentifiers.length; i++) {
      up.sleeps.ticks({
        xid: sleepIdentifiers[i]
      }, function (error, body) {
        if (error) {
          console.log(new Date() + ': Error Receiving Jawbone UP Data: ' + error)
        }
        sleepCounter++
        parseTicksData(error, body, SLEEP_TICKS_HEADERS, 'sleep_ticks.csv', sleepCounter)
      })
    }
    if (sleepIdentifiers.length === 0) {
      convertAndFlush(sleepTicksData, SLEEP_TICKS_HEADERS, 'sleep_ticks.csv', false)
    }
  }
}

function parseTicksData (err, body, headers, filename, index) {
  if (err) {
    console.log(new Date() + ': Error Receiving Jawbone UP Data: ' + err)
  } else {
    let dataItems = JSON.parse(body).data.items
    if (dataItems) {
      for (let j = 0; j < dataItems.length; j++) {
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
    let dailyDataJsonArray = [], newDailyDataJsonObject, dailyDataJsonObject
    if (dataSummary.length > 0) {
      dailyDataJsonArray = dataSummary.filter(function (value) {
        return value.date === entry.date
      })
    }
    if (dailyDataJsonArray.length === 0) {
      dailyDataJsonObject = {}
      dailyDataJsonObject['date'] = entry.date
      dailyDataJsonObject.user_email = user.email
      dailyDataJsonObject.ema_id = user.studyId
      dailyDataJsonObject['resting_heartrate'] = ''
      dailyDataJsonObject['step_count'] = ''
      dailyDataJsonObject['sleep_duration'] = ''
      newDailyDataJsonObject = true
    } else {
      dailyDataJsonObject = dailyDataJsonArray[0]
      newDailyDataJsonObject = false
    }

    if (entry.resting_heartrate) {
      dailyDataJsonObject['resting_heartrate'] = entry.resting_heartrate
    }
    if (entry.details.steps) {
      dailyDataJsonObject['step_count'] = entry.details.steps
    }
    if (entry.details.duration) {
      dailyDataJsonObject['sleep_duration'] = formatSeconds(entry.details.duration)
    }

    if (newDailyDataJsonObject) {
      dataSummary.push(dailyDataJsonObject)
    }
  })

  summaryCounter++
  if (summaryCounter === 3) {
    dataSummary.sort(compare)
    let summary = JSON.parse(JSON.stringify(dataSummary))
    convertAndFlush(summary, SUMMARY_HEADERS, 'summary.csv', false)
    sanitizeCombinedSummaryData(dataSummary)
  }
}

function formatSeconds (durationInSeconds) {
  let hours = Math.floor(parseInt(durationInSeconds) / 3600)
  durationInSeconds %= 3600
  let minutes = Math.floor(parseInt(durationInSeconds) / 60)
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

function appendZero (str) {
  if (typeof str === 'number') {
    str = str.toString()
  }
  if (str.length === 1) {
    str = '0' + str
  }
  return str
}

function sanitizeCombinedSummaryData (summaryArray) {
  let date
  if (summaryArray.length < DURATION) {
    for (let i = 0; i < DURATION; i++) {
      let newStartDate = new Date(JSON.parse(JSON.stringify(originalStartDate)))
      let dataDate = new Date(newStartDate.setTime(newStartDate.getTime() + i * 86400000)).toLocaleDateString().split('/')
      let month = dataDate[0], day = dataDate[1]
      month = appendZero(month)
      day = appendZero(day)
      date = parseInt(dataDate[2] + month + day)
      let dailyDataJsonArray = summaryArray.filter(function (value) {
        return value.date === date
      })
      if (dailyDataJsonArray.length === 0) {
        let jsonObject = {}
        jsonObject.date = date
        jsonObject.user_email = user.email
        jsonObject.ema_id = user.studyId
        jsonObject.resting_heartrate = ''
        jsonObject.step_count = ''
        jsonObject.sleep_duration = ''
        summaryArray.push(jsonObject)
      }
    }
    summaryArray.sort(compare)
  }
  writeWideFormat(summaryArray)
  writeLongFormat(summaryArray)
  writeShortFormat(summaryArray)
}

function writeWideFormat (data) {
  let userData = []
  let dataRow = generateDefaultRowData()
  for (let j = 0; j < data.length; j++) {
    dataRow['day_' + j] = formatDateString(data[j]['date'].toString())
    dataRow['resting_heartrate_day_' + j] = data[j]['resting_heartrate']
    dataRow['sleep_duration_day_' + j] = data[j]['sleep_duration']
    dataRow['step_count_day_' + j] = data[j]['step_count']
  }
  userData.push(dataRow)
  writeToFile(userData, wideSummaryHeaders, wideSummaryFile, false, false)
}

function writeLongFormat (data) {
  let userData = []
  for (let j = 0; j < data.length; j++) {
    let dataRow = generateDefaultRowData()
    dataRow['day'] = formatDateString(data[j]['date'].toString())
    dataRow['resting_heartrate'] = data[j]['resting_heartrate']
    dataRow['sleep_duration'] = data[j]['sleep_duration']
    dataRow['step_count'] = data[j]['step_count']
    userData.push(dataRow)
  }
  writeToFile(userData, longSummaryHeaders, longSummaryFile, false, false)
}

function writeShortFormat (data) {
  let userData = []
  let sleepDays = data.filter(function (value) {
    return (value.sleep_duration !== null && value.sleep_duration !== '')
  })
  let stepDays = data.filter(function (value) {
    return (value.step_count !== null && value.step_count !== '')
  })
  let dataRow = {
    'USERID': user.userId,
    'SUBJECTID': user.studyId,
    'JAWBONEEMAIL': user.email,
    'NUMSLEEPDAYS': sleepDays.length,
    'NUMSTEPDAYS': stepDays.length,
    'STARTDATE': originalStartDate.toLocaleDateString(),
    'REASON': user.reason
  }
  userData.push(dataRow)
  writeToFile(userData, SHORT_SUMMARY_HEADERS, shortSummaryFile, false, false)
}

function formatDateString (str) {
  return new Date(str.substring(0, 4), (parseInt(str.substring(4, 6)) - 1).toString(), str.substring(6)).toLocaleDateString()
}

function generateDefaultRowData () {
  let dataRow = {}
  dataRow['study_id'] = user.studyId
  dataRow['jawbone_email'] = user.email
  dataRow['gender'] = user.gender
  dataRow['height'] = user.height
  dataRow['gender_label'] = user.gender ? 'female' : 'male'
  dataRow['weight'] = user.weight
  dataRow['study_start_date'] = originalStartDate.toLocaleDateString()
  return dataRow
}
