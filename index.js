const createScheduler = require('probot-scheduler');

module.exports = (robot) => {
  scheduler = createScheduler(robot, {
    delay: !process.env.DISABLE_DELAY,
    interval: 60 * 60 * 1000 * 24 * 3 // 3 days
  });

  var pullRequestAuthor;
  var apiForSheets = function(userName, context, isPullRequest) {
    var claLabel = ['PR: don\'t merge - NEEDS CLA'];
    var hasUserSignedCla = false;
    var spreadsheetId = process.env.SPREADSHEET_ID;
    // Google Sheets API v4
    var fs = require('fs');
    var readline = require('readline');
    var google = require('googleapis');
    var googleAuth = require('google-auth-library');

    // If modifying these scopes, delete your previously saved credentials
    // at ~/.credentials/sheets.googleapis.com-nodejs-quickstart.json
    var SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
    var clientSecret = process.env.CLIENT_SECRET;

    /**
      * Create an OAuth2 client with the given credentials, and then execute the
      * given callback function.
      *
      * @param {Object} credentials The authorization client credentials.
      * @param {function} callback The callback to call with the
      *   authorized client.
      */
    var authorize = function(credentials, callback) {
      var clientSecret = credentials.installed.client_secret;
      var clientId = credentials.installed.client_id;
      var redirectUrl = credentials.installed.redirect_uris[0];
      var auth = new googleAuth();
      var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);
      oauth2Client.credentials = JSON.parse(process.env.CREDENTIALS);
      callback(oauth2Client);
    };

    /**
      * Get and store new token after prompting for user authorization, and then
      * execute the given callback with the authorized OAuth2 client.
      *
      * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get
      *   token for.
      * @param {getEventsCallback} callback The callback to call with
      *    the authorized client.
      */
    var getNewToken = function(oauth2Client, callback) {
      var authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES
      });
      // eslint-disable-next-line no-console
      console.log('Authorize this app by visiting this url: ', authUrl);
      var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question('Enter the code from that page here: ', function(code) {
        rl.close();
        oauth2Client.getToken(code, function(err, token) {
          if (err) {
            // eslint-disable-next-line no-console
            console.log('Error while trying to retrieve access token', err);
            return;
          }
          oauth2Client.credentials = token;
          storeToken(token);
          callback(oauth2Client);
        });
      });
    };

    /**
      * Store token to disk be used in later program executions.
      *
      * @param {Object} token The token to store to disk.
      */
    var storeToken = function(token) {
      try {
        fs.mkdirSync(TOKEN_DIR);
      } catch (err) {
        if (err.code !== 'EEXIST') {
          throw err;
        }
      }
      fs.writeFile(TOKEN_PATH, JSON.stringify(token));
      // eslint-disable-next-line no-console
      console.log('Token stored to ' + TOKEN_PATH);
    };


    var checkClaSheet = function(auth) {
      var sheets = google.sheets('v4');
      sheets.spreadsheets.values.get({
        auth: auth,
        spreadsheetId: spreadsheetId,
        range: 'Usernames!A:A',
      }, function(err, response) {
        if (err) {
          // eslint-disable-next-line no-console
          console.log('The API returned an error: ' + err);
          return;
        }
        var rows = response.values;
        if (rows.length === 0) {
          // eslint-disable-next-line no-console
          console.log('No data found.');
        } else {
          var params;

          const labels = context.github.issues.getIssueLabels(
            context.issue());
          var labelData;
          var claFlag = false;
          labels.then((resp) => {
            labelData = resp.data;
            for (var label in labelData) {
              if (labelData[label].name === claLabel[0]) {
                claFlag = true;
                break;
              }
            }

            if (claFlag === true) {
              for (var row in rows) {
                var rowUserName = rows[row][0];
                if (rowUserName === userName) {
                  hasUserSignedCla = true;
                  break;
                }
              }
              if (hasUserSignedCla === true) {
                context.github.issues.removeLabel(context.issue({
                  name: claLabel[0]
                }));
              }
              return;
            }

            if (isPullRequest === true) {
              for (var row in rows) {
                var rowUserName = rows[row][0];
                if (rowUserName === userName) {
                  hasUserSignedCla = true;
                  break;
                }
              }
              if (hasUserSignedCla !== true) {
                var linkText = 'here';
                var linkResult = linkText.link(
                  'https://github.com/oppia/oppia/wiki/Contributing-code-to-Oppia#setting-things-up');
                params = context.issue({
                  body: 'Hi! @' + userName +
                  '. Welcome to Oppia! Please could you ' +
                  'follow the instructions ' + linkResult +
                  ' to get started ? You\'ll need to do ' +
                  'this before we can accept your PR. Thanks!'});
                context.github.issues.addLabels(context.issue({
                  labels: claLabel
                }));
                return context.github.issues.createComment(params);
              }
            }
          });
        }
      });
    };

    // Authorize a client with the loaded credentials, then call the
    // Google Sheets API.
    authorize(JSON.parse(clientSecret), checkClaSheet);
  };

  var checkMergeConflicts = async function(context) {
    var mergeConflictLabel = ['PR: don\'t merge - HAS MERGE CONFLICTS'];
    pullRequestsPromiseObj = await context.github.pullRequests.getAll(
      context.repo({per_page: 40}));

    arrayOfOpenPullRequests = pullRequestsPromiseObj.data;
    var hasMergeConflictLabel;
    for (var indexOfPullRequest in arrayOfOpenPullRequests) {
      pullRequestNumber = arrayOfOpenPullRequests[
        indexOfPullRequest].number;
      pullRequestDetailsPromiseObj = await context.github.pullRequests.get(
        context.repo({number: pullRequestNumber}));

      pullRequestDetails = pullRequestDetailsPromiseObj.data;
      hasMergeConflictLabel = false;
      labels = pullRequestDetails.labels;
      for (var label in labels) {
        if (labels[label].name === mergeConflictLabel[0]) {
          hasMergeConflictLabel = true;
          break;
        }
      }

      isMergeable = pullRequestDetails.mergeable;

      if (hasMergeConflictLabel === false && isMergeable === false) {
        userName = pullRequestDetails.user.login;
        var linkText = 'link';
        var linkResult = linkText.link(
          'https://help.github.com/articles/resolving-a-merge-conflict-using-the-command-line/');
        var params = context.repo({
          number: pullRequestNumber,
          body: 'Hi @' + userName +
            '. The latest commit in this PR has resulted in ' +
            'a merge conflict. Please follow this ' + linkResult +
            ' if you need help to resolve the conflict. Thanks!'});
        labelPromiseObj = await context.github.issues.addLabels(context.repo({
          number: pullRequestNumber,
          labels: mergeConflictLabel}));
        await context.github.issues.createComment(params);
      }

      if (hasMergeConflictLabel === true && isMergeable === true) {
        await context.github.issues.removeLabel(context.repo({
          number: pullRequestNumber,
          name: mergeConflictLabel[0]
        }));
      }
    }
  };

  /*
    Please use GitHub Webhook Payloads and not REST APIs.
    Link:  https://octokit.github.io/rest.js/
   */

  robot.on('issue_comment.created', async context => {
    if (context.isBot === false) {
      const userName = context.payload.comment.user.login;
      if (pullRequestAuthor === userName) {
        apiForSheets(userName, context, false);
      }
    }
  });

  robot.on('pull_request.opened', async context => {
    if (context.isBot === false) {
      const userName = context.payload.pull_request.user.login;
      pullRequestAuthor = userName;
      apiForSheets(userName, context, true);
    }
  });

  robot.on('schedule.repository', async context => {
    await checkMergeConflicts(context);
  });
};
