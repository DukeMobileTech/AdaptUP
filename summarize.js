const fs = require('fs')
const converter = require('json-2-csv')
const path = require('path')

let dataDir
let wideSummaryFiles = [], longSummaryFiles = [], shortSummaryFiles = []
const shortHeaders = ['user_id', 'subject_id',	'jawbone_email',	'num_sleep_days',	'num_step_days']
const longHeaders = ['study_id', 'jawbone_email',	'gender',	'height',	'gender_label',	'weight',	'day',	'resting_heartrate',	'sleep_duration',	'step_count']

function summaryFilesSearch () {
  let idFolders = fs.readdirSync(dataDir).filter(file => fs.statSync(path.join(dataDir, file)).isDirectory())
  if (idFolders.indexOf('summaries') > -1) {
    idFolders.splice(idFolders.indexOf('summaries'), 1)
  }
  idFolders.forEach(function (folder, index, array) {
    let idFolder = dataDir + folder + '/'
    let dateFolders = fs.readdirSync(idFolder).filter(file => fs.statSync(path.join(idFolder, file)).isDirectory())
    let dateFolder = idFolder + Math.max.apply(null, dateFolders.map(Number))
    let dataFiles = fs.readdirSync(dateFolder)
    dataFiles.forEach(function (file, ind, arr) {
      file = dateFolder + '/' + file
      if (file.split('/').pop() === 'wide_summary.csv') {
        wideSummaryFiles.push(file)
      } else if (file.split('/').pop() === 'long_summary.csv') {
        longSummaryFiles.push(file)
      } else if (file.split('/').pop() === 'short_summary.csv') {
        shortSummaryFiles.push(file)
      }
      if (index === array.length - 1 && ind === arr.length - 1) {
        combineSummaryFiles(wideSummaryFiles, dataDir + 'summaries/' + new Date().getTime().toString() + '_wide.csv')
        combineSummaryFiles(longSummaryFiles, dataDir + 'summaries/' + new Date().getTime().toString() + '_long.csv', longHeaders)
        combineSummaryFiles(shortSummaryFiles, dataDir + 'summaries/' + new Date().getTime().toString() + '_short.csv', shortHeaders)
      }
    })
  })

}

function combineSummaryFiles (summaryFiles, filename, headers = []) {
  let dataArray = []
  summaryFiles.forEach(function (file, index, array) {
    fs.readFile(file, 'utf8', function (err, csv) {
      if (err) { console.log('Error reading wide summary csv file: ', err) }
      converter.csv2json(csv, function (error, json) {
        if (error) { console.log('Error converting wide summary csv to json: ', error) }
        dataArray = dataArray.concat(json)
        if (index === array.length - 1) {
          if (headers.length === 0) {
            dataArray.forEach(function (jsonObject) {
              Object.keys(jsonObject).forEach(function (key) {
                if (headers.indexOf(key) === -1) {
                  headers.push(key)
                }
              })
            })
          }
          converter.json2csv(dataArray, function (er, csvData) {
            if (er) { console.log('Error converting json to csv: ', er) }
            fs.writeFile(filename, csvData, function (e) {
              if (e) console.log('Error writing json data to file: ', e)
            })
          }, {keys: headers, prependHeader: true, checkSchemaDifferences: false, emptyFieldValue: ''})
        }
      })
    })
  })
}

exports.summarize = function (dir) {
  dataDir = dir
  summaryFilesSearch()
}

/* For testing from the cli */
// function test_summarize () {
//   dataDir = 'data/'
//   summaryFilesSearch()
// }
//
// test_summarize()