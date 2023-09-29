// create a .env file with these values in the same directory as this file
// JAMF_JSS_URL=https://jss.example.com:8443
// JAMF_USER=apiuser
// JAMF_PASSWORD=apipassword
//
// make sure node is installed on your system
// run `npm install` to install dependencies
// run `node index.js` to run the script

const fs = require('fs');
const axios = require('axios');
const { log } = require('console');
const timers = require('timers/promises');

require('dotenv').config();

// DATA FILES
const mobileApplicationsFile = './mobileApplications.json';
const sortedApplicationsFile = './sortedApplications.json';
const tokenFile = './token.json';
const resultsFile = './results.txt';

// Jamf PRO API CREDENTIALS
const url = process.env.JAMF_JSS_URL;
const username = process.env.JAMF_USER;
const password = process.env.JAMF_PASSWORD;

// ENDPOINTS
const mobileDeviceApplicationsEndpoint =
  '/JSSResource/mobiledeviceapplications';

// CONSTANTS
const QUERY_DELAY = 1000; // 1 second

// DATA VARIABLES
let jssToken;
let mobileApplications;
const sortedApplications = {
  licensedPurchasedInUse: [],
  licensedPurchasedNotInUse: [],
  licensedUnpurchased: [],
  unlicensed: [],
  other: [],
};
let hasDeletions = false;

//////////////////////////
// HELPER FUNCTIONS

// helper function to determine if the loaded JSS token is valid
const validJssToken = (token) => {
  if (!token) {
    return false;
  }

  if (!token.hasOwnProperty('expires')) {
    return false;
  }

  const now = new Date(Date.now());
  const tokenExpiration = new Date(token.expires);

  return tokenExpiration > now;
};

// helper function to remove an application from the list of mobile applications
const removeApplication = async (appId) => {
  if (!markAppIdNull(appId, mobileApplications)) {
    // app id not found in mobile applications
    return;
  }
  // app id was found in mobile applications
  hasDeletions = true;
  // remove it from the sorted array that it belongs to
  if (markAppIdNull(appId, sortedApplications.licensedPurchasedInUse)) {
    return;
  }
  if (markAppIdNull(appId, sortedApplications.licensedPurchasedNotInUse)) {
    return;
  }
  if (markAppIdNull(appId, sortedApplications.licensedUnpurchased)) {
    return;
  }
  if (markAppIdNull(appId, sortedApplications.unlicensed)) {
    return;
  }
  markAppIdNull(appId, sortedApplications.other);
};

const markAppIdNull = (appId, arr) => {
  const index = arr.findIndex((app) => app.id === appId);
  if (index > -1) {
    arr[index].id = null;
    return true;
  }
};

const cleanupApplications = () => {
  cleanAppArray(mobileApplications);
  cleanAppArray(sortedApplications.licensedPurchasedInUse);
  cleanAppArray(sortedApplications.licensedPurchasedNotInUse);
  cleanAppArray(sortedApplications.licensedUnpurchased);
  cleanAppArray(sortedApplications.unlicensed);
  cleanAppArray(sortedApplications.other);
};

const cleanAppArray = (appArray) => {
  for (let i = 0; i < appArray.length; i++) {
    const app = appArray[i];
    if (!app.id) {
      appArray.splice(i, 1);
      i--;
    }
  }
};

const cleanup = () => {
  if (hasDeletions) {
    cleanupApplications();
    saveMobileApplications();
    saveSortedApplications();
    exportSortedApplications();
  }
};

//////////////////////////
// API CALLS VIA AXIOS

// get a new JSS token if the current one is expired or missing
const getAccessToken = async () => {
  let isModified = false;

  if (!validJssToken(jssToken)) {
    console.log('Getting new auth token from JSS');

    const response = await axios({
      method: 'post',
      url: `${url}/api/v1/auth/token`,
      auth: {
        username: username,
        password: password,
      },
    }).then((response) => {
      console.log(response.data);
      jssToken = response.data;
      isModified = true;
    });
  } else {
    console.log(
      `## Using existing valid token that expires at ${jssToken.expires}`
    );
  }

  if (isModified) {
    console.log(`Saving token to ${tokenFile}`);
    saveJssToken();
  }
};

// get full list of ios applications from JSS
const getAllApplications = async (forceRefreshData = false) => {
  let isModified = false;

  if (mobileApplications.length === 0 || forceRefreshData) {
    mobileApplications = [];
    console.log('Getting all mobile applications from JSS');

    const response = await axios({
      method: 'get',
      url: `${url}${mobileDeviceApplicationsEndpoint}`,
      headers: { Authorization: `Bearer ${jssToken.token}` },
    }).then((response) => {
      mobileApplications = response.data.mobile_device_applications;
      isModified = true;
      console.log(`Found ${mobileApplications.length} mobile applications`);
    });
  } else {
    console.log(
      `Using existing ${mobileApplications.length} mobile applications from ${mobileApplicationsFile}`
    );
  }

  if (isModified) {
    console.log(`Saving mobile applications to ${mobileApplicationsFile}`);
    saveMobileApplications();
  }
};

// get single application's VPP data from JSS
const getApplicationVPPData = async (appId) => {
  let vpp = {};

  if (!appId) {
    return vpp;
  }

  const response = await axios({
    method: 'get',
    url: `${url}${mobileDeviceApplicationsEndpoint}/id/${appId}/subset/VPP`,
    headers: { Authorization: `Bearer ${jssToken.token}` },
  })
    .then((response) => {
      vpp = response.data.mobile_device_application.vpp;
    })
    .catch((error) => {
      console.log(error);
    });

  return vpp;
};

// delete a mobile application from JSS
const deleteMobileDeviceApplication = async (appId) => {
  if (!appId) {
    return;
  }

  const response = await axios({
    method: 'delete',
    url: `${url}${mobileDeviceApplicationsEndpoint}/id/${appId}`,
    headers: { Authorization: `Bearer ${jssToken.token}` },
  })
    .then((response) => {
      if (response.status === 200) {
        console.log(`Deleted mobile application ${appId}`);
        removeApplication(appId);
      }
    })
    .catch((error) => {
      console.log(error);
    });
};

//////////////////////////
// API HELPER FUNCTIONS

// get VPP data for a range of mobile applications
// end is included in the range
const getVppDataForRange = async (start, end) => {
  if (end >= mobileApplications.length) {
    end = mobileApplications.length - 1;
  }

  let isModified = false;

  for (let i = start; i <= end; i++) {
    const application = mobileApplications[i];
    if (!application.hasOwnProperty('vpp')) {
      console.log(
        `Getting VPP data for [${application.id}] ${application.name}`
      );
      const data = await getApplicationVPPData(application.id);
      console.log(`VPP data for [${application.id}] ${application.name}`);
      console.log(data);

      application.vpp = data;
      isModified = true;

      if (i != end) {
        await timers.setTimeout(QUERY_DELAY);
      }
    }
  }

  if (isModified) {
    console.log(`Saving mobile applications to ${mobileApplicationsFile}`);
    saveMobileApplications();
    sortApplications();
    exportSortedApplications();
  }
};

const getAllApplicationsVppData = async (forceRefreshData = false) => {
  let isModified = false;

  console.log('Getting VPP data for all mobile applications');

  for (let i = 0; i < mobileApplications.length; i++) {
    const application = mobileApplications[i];
    if (!application.hasOwnProperty('vpp') || forceRefreshData) {
      console.log(
        `Getting VPP data for [${application.id}] ${application.name}`
      );
      application.vpp = await getApplicationVPPData(application.id);
      isModified = true;

      if (i != mobileApplications.length - 1) {
        await timers.setTimeout(QUERY_DELAY);
      }
    }
  }

  if (isModified) {
    saveMobileApplications();
    sortApplications();
    exportSortedApplications();
  }
};

const sortApplications = () => {
  if (mobileApplications.length <= 0) {
    return;
  }
  sortedApplications.licensedPurchasedInUse = [];
  sortedApplications.licensedPurchasedNotInUse = [];
  sortedApplications.licensedUnpurchased = [];
  sortedApplications.unlicensed = [];
  sortedApplications.other = [];
  for (let i = 0; i < mobileApplications.length; i++) {
    const app = mobileApplications[i];
    sortApplication(app);
  }

  saveSortedApplications();
};

const sortApplication = (app) => {
  if (!app.hasOwnProperty('vpp')) {
    return;
  }

  if (!app.vpp.hasOwnProperty('total_vpp_licenses')) {
    sortedApplications.unlicensed.push(app);
  } else if (app.vpp.total_vpp_licenses === 0) {
    sortedApplications.licensedUnpurchased.push(app);
  } else if (app.vpp.used_vpp_licenses === 0) {
    sortedApplications.licensedPurchasedNotInUse.push(app);
  } else if (app.vpp.used_vpp_licenses > 0) {
    sortedApplications.licensedPurchasedInUse.push(app);
  } else {
    sortedApplications.other.push(app);
  }
};

const deleteAllNotInUseApplications = async (includeLicensed = false) => {
  deleteUnlicensedApplications();
  deleteLicensedUnpurchasedApplications();
  if (includeLicensed) {
    deleteLicensedPurchasedNotInUseApplications();
  }
};

const deleteUnlicensedApplications = async () => {
  for (let i = 0; i < sortedApplications.unlicensed.length; i++) {
    const app = sortedApplications.unlicensed[i];
    console.log(`Deleting ${app.name}`);
    await deleteMobileDeviceApplication(app.id);

    if (i != sortedApplications.unlicensed.length - 1) {
      await timers.setTimeout(QUERY_DELAY);
    }
  }
};

const deleteLicensedUnpurchasedApplications = async () => {
  for (let i = 0; i < sortedApplications.licensedUnpurchased.length; i++) {
    const app = sortedApplications.licensedUnpurchased[i];
    console.log(`Deleting ${app.name}`);
    await deleteMobileDeviceApplication(app.id);

    if (i != sortedApplications.licensedUnpurchased.length - 1) {
      await timers.setTimeout(QUERY_DELAY);
    }
  }
};

const deleteLicensedPurchasedNotInUseApplications = async () => {
  for (
    let i = 0;
    i < sortedApplications.licensedPurchasedNotInUse.length;
    i++
  ) {
    const app = sortedApplications.licensedPurchasedNotInUse[i];
    console.log(`Deleting ${app.name}`);
    await deleteMobileDeviceApplication(app.id);

    if (i != sortedApplications.licensedPurchasedNotInUse.length - 1) {
      await timers.setTimeout(QUERY_DELAY);
    }
  }
};

// added for completion, but likely never want to run this function
const deleteLicensedPurchasedInUseApplications = async () => {
  for (let i = 0; i < sortedApplications.licensedPurchasedInUse.length; i++) {
    const app = sortedApplications.licensedPurchasedInUse[i];
    console.log(`Deleting ${app.name}`);
    await deleteMobileDeviceApplication(app.id);

    if (i != sortedApplications.licensedPurchasedInUse.length - 1) {
      await timers.setTimeout(QUERY_DELAY);
    }
  }
};

const deleteOtherApplications = async () => {
  for (let i = 0; i < sortedApplications.other.length; i++) {
    const app = sortedApplications.other[i];
    console.log(`Deleting ${app.name}`);
    await deleteMobileDeviceApplication(app.id);

    if (i != sortedApplications.other.length - 1) {
      await timers.setTimeout(QUERY_DELAY);
    }
  }
};

//////////////////////////
// SAVE DATA TO FILES

const saveMobileApplications = async () => {
  fs.writeFile(
    mobileApplicationsFile,
    JSON.stringify(mobileApplications, null, 2),
    (err) => {
      if (err) {
        console.log('Error saving mobile applications');
        return;
      }
      //console.log(`Mobile applications saved to ${mobileApplicationsFile}`);
    }
  );
};

const saveSortedApplications = () => {
  fs.writeFile(
    sortedApplicationsFile,
    JSON.stringify(sortedApplications, null, 2),
    (err) => {
      if (err) {
        console.log('Error saving sorted applications');
        return;
      }
      //console.log(`Sorted applications saved to ${sortedApplicationsFile}`);
    }
  );
};

const saveJssToken = () => {
  // console.log(`Saving token to ${tokenFile}`);

  fs.writeFile(tokenFile, JSON.stringify(jssToken, null, 2), (err) => {
    if (err) {
      console.log('Error saving token');
      return;
    }
    console.log(`Token saved to ${tokenFile}`);
  });
};

//////////////////////////
// LOAD DATA FROM FILES

const loadMobileApplications = () => {
  const data = fs.readFileSync(mobileApplicationsFile, {
    encoding: 'utf8',
    flag: 'r',
  });
  try {
    mobileApplications = JSON.parse(data);
  } catch (err) {
    console.log('Error loading mobile applications');
  }
};

const loadSortedApplications = () => {
  const data = fs.readFileSync(sortedApplicationsFile, {
    encoding: 'utf8',
    flag: 'r',
  });
  try {
    const parsedData = JSON.parse(data);
    sortedApplications.licensedPurchasedInUse =
      parsedData.licensedPurchasedInUse || [];
    sortedApplications.licensedPurchasedNotInUse =
      parsedData.licensedPurchasedNotInUse || [];
    sortedApplications.licensedUnpurchased =
      parsedData.licensedUnpurchased || [];
    sortedApplications.unlicensed = parsedData.unlicensed || [];
    sortedApplications.other = parsedData.other || [];
  } catch (err) {
    console.log('Error loading sorted applications');
  }
};

const loadJssToken = () => {
  const data = fs.readFileSync(tokenFile, { encoding: 'utf8', flag: 'r' });
  try {
    jssToken = JSON.parse(data);
  } catch (err) {
    console.log('Error loading token');
  }
};

const loadData = () => {
  loadJssToken();
  loadMobileApplications();
  loadSortedApplications();
};

//////////////////////////
// EXPORT DATA TO FILE

const exportSortedApplications = () => {
  let output = '';

  output += `Licensed Purchased In Use: ${sortedApplications.licensedPurchasedInUse.length}`;
  for (let i = 0; i < sortedApplications.licensedPurchasedInUse.length; i++) {
    const app = sortedApplications.licensedPurchasedInUse[i];
    output += `\n${app.name}`;
  }

  output += `\n\nLicensed Purchased Not In Use: ${sortedApplications.licensedPurchasedNotInUse.length}`;
  for (
    let i = 0;
    i < sortedApplications.licensedPurchasedNotInUse.length;
    i++
  ) {
    const app = sortedApplications.licensedPurchasedNotInUse[i];
    output += `\n${app.name}`;
  }

  output += `\n\nLicensed Unpurchased: ${sortedApplications.licensedUnpurchased.length}`;
  for (let i = 0; i < sortedApplications.licensedUnpurchased.length; i++) {
    const app = sortedApplications.licensedUnpurchased[i];
    output += `\n${app.name}`;
  }

  output += `\n\nUnlicensed: ${sortedApplications.unlicensed.length}`;
  for (let i = 0; i < sortedApplications.unlicensed.length; i++) {
    const app = sortedApplications.unlicensed[i];
    output += `\n${app.name}`;
  }

  output += `\n\nOther: ${sortedApplications.other.length}`;
  for (let i = 0; i < sortedApplications.other.length; i++) {
    const app = sortedApplications.other[i];
    output += `\n${app.name}`;
  }

  fs.writeFile(resultsFile, output, (err) => {
    if (err) {
      console.log('Error saving results');
      return;
    }
    console.log(`Results saved to ${resultsFile}`);
  });
};

//////////////////////////
// PROGRAM EXECUTION

const processFlags = async () => {
  const fetchApps = process.argv.indexOf('--apps') > -1 ? true : false;
  const fetchAllVpp = process.argv.indexOf('--vpp') > -1 ? true : false;
  const fetchRangeVpp = process.argv.indexOf('--vpp-range') > -1 ? true : false;
  const vppRangeStart = fetchRangeVpp
    ? parseInt(process.argv[process.argv.indexOf('--vpp-range') + 1])
    : 0;
  const vppRangeEnd = fetchRangeVpp
    ? parseInt(process.argv[process.argv.indexOf('--vpp-range') + 2])
    : mobileApplications.length - 1;
  const deleteUnlicensed =
    process.argv.indexOf('--delete-unlicensed') > -1 ? true : false;
  const deleteLicensedUnpurchased =
    process.argv.indexOf('--delete-licensed-unpurchased') > -1 ? true : false;
  const deleteLicensedNotInUse =
    process.argv.indexOf('--delete-licensed-not-in-use') > -1 ? true : false;
  const deleteLicensedInUse =
    process.argv.indexOf('--delete-licensed-in-use') > -1 ? true : false;
  const deleteOther =
    process.argv.indexOf('--delete-other') > -1 ? true : false;

  if (fetchApps) {
    await getAllApplications(true);
  }

  if (fetchAllVpp) {
    await getAllApplicationsVppData(true);
  }

  if (fetchRangeVpp) {
    await getVppDataForRange(vppRangeStart, vppRangeEnd);
  }

  if (deleteUnlicensed) {
    await deleteUnlicensedApplications();
  }

  if (deleteLicensedUnpurchased) {
    await deleteLicensedUnpurchasedApplications();
  }

  if (deleteLicensedNotInUse) {
    await deleteLicensedPurchasedNotInUseApplications();
  }

  if (deleteLicensedInUse) {
    await deleteLicensedPurchasedInUseApplications();
  }

  if (deleteOther) {
    await deleteOtherApplications();
  }
};

const main = async () => {
  await getAccessToken();
  await processFlags();
  cleanup();
};

loadData();
main();
