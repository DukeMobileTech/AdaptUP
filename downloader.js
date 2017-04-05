let webDriver = require('selenium-webdriver')
let lineReader = require('line-reader')

let userDetails = []
let downloadDone
let userCount = 0
const WAIT_TIME = 120000
let strategy = require('./strategy.js')

let browser = new webDriver.Builder().usingServer().withCapabilities({'browserName': 'chrome'}).build()

exports.getBrowser = () => {
  return browser
}

exports.startDownload = function () {
  lineReader.eachLine('config/test.csv', function (line, last) {
    userDetails.push(line)
    if (last) {
      downloadUserData(userDetails[0])
      return false
    }
  })
}

function downloadUserData (userString) {
  let userInfo = userString.split(',')
  if (userInfo[4].indexOf('/') === -1 && userInfo[4].lastIndexOf('/') === -1) {
    strategy.getUser().setReason(userInfo[4])
  } else {
    strategy.getUser().setReason(null)
  }
  console.log('start user download for user # ' + userCount + ' with ID ' + userInfo[0])
  browser.get('https://localhost:5000/')
  // First page
  let idElement = browser.wait(webDriver.until.elementLocated(webDriver.By.id('emaId')), WAIT_TIME)
  idElement.clear()
  idElement.sendKeys(userInfo[0])
  let emailElement = browser.wait(webDriver.until.elementLocated(webDriver.By.id('email')), WAIT_TIME)
  emailElement.clear()
  emailElement.sendKeys(userInfo[1])
  let startDateElement = browser.wait(webDriver.until.elementLocated(webDriver.By.id('startDate')), WAIT_TIME)
  startDateElement.clear()
  startDateElement.sendKeys(userInfo[2])
  let submitElement = browser.wait(webDriver.until.elementLocated(webDriver.By.id('submit')), WAIT_TIME)
  submitElement.click()
  // Second page
  let loginElement = browser.wait(webDriver.until.elementLocated(webDriver.By.id('login')), WAIT_TIME)
  loginElement.click()
  // Third page
  let jawboneEmailElement = browser.wait(webDriver.until.elementLocated(webDriver.By.id('jawbone-signin-email')), WAIT_TIME)
  jawboneEmailElement.sendKeys(userInfo[1])
  let jawbonePasswordElement = browser.wait(webDriver.until.elementLocated(webDriver.By.id('jawbone-signin-password')), WAIT_TIME)
  jawbonePasswordElement.sendKeys(userInfo[3])
  let signInElement = browser.wait(webDriver.until.elementLocated(webDriver.By.xpath('//button[@type=\'submit\'][@class=\'form-button\']')), WAIT_TIME)
  signInElement.click()
  // Fourth page
  let agreeElement = browser.wait(webDriver.until.elementLocated(webDriver.By.xpath('//button[@type=\'submit\'][@class=\'form-button\']')), WAIT_TIME)
  agreeElement.click()
  // Last page
  clickOnLogoutButton()
}

function clickOnLogoutButton () {
  setTimeout(function () {
    if (downloadDone) {
      let logoutElement = browser.wait(webDriver.until.elementLocated(webDriver.By.id('adaptup-logout')), WAIT_TIME)
      logoutElement.click()
      downloadDone = false
      console.log('user download done for: ' + userCount)
      userCount++
      if (userCount < userDetails.length) {
        downloadUserData(userDetails[userCount])
      } else {
        downloadDone = true
      }
    } else {
      clickOnLogoutButton()
    }
  }, 50)
}

exports.setDownloadDone = status => {
  downloadDone = status
}

exports.getDownloadDone = () => {
  return downloadDone
}

exports.getUserDetails = () => {
  return userDetails
}

exports.lastUser = () => {
  return userCount >= userDetails.length
}

exports.getUserCount = () => {
  return userCount
}