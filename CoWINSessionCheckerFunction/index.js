
module.exports = async function (context, req) {
    context.log.info('CheckCoWinSlots function has been trigerred');
    //Dependencies
    const axios = require('axios');
    const CosmosClient = require("@azure/cosmos").CosmosClient;
    const { DefaultAzureCredential } = require("@azure/identity");
    const { SecretClient } = require("@azure/keyvault-secrets");
    const twilio = require('twilio');

    //Capture detailed status for response
    var responseMessage = {
      "BookingDate": "na",
      "CosmosConfigRetrieval": "na",
      "CoWINIntegration": "na",
      "alert1": "na",
      "CosmosUpdate1": "na",
      "alert2": "na",
      "CosmosUpdate2": "na"
    };

    //Connect to Azure key vault
    const keyVaultCredential = new DefaultAzureCredential();
    const keyVaultClient = new SecretClient(process.env["AzureKeyVaultUrl"], keyVaultCredential);

    //CosmosDB connection details
    const cosmosdbConnString = (await keyVaultClient.getSecret("cosmosDbPrimaryConnectionString")).value;
    const databaseId = process.env["AzureCoWINDatabaseId"];
    const containerId = process.env["AzureCoWINContainerId"];
    const partitionKey = { kind: 'Hash', paths: ['/mobileNumber'] };
    const cosmosClient = new CosmosClient(cosmosdbConnString);

    //Twilio connection details
    const twilioAccountSid = (await keyVaultClient.getSecret("twilioAccountSid")).value;
    const twilioAuthToken = (await keyVaultClient.getSecret("twilioAuthToken")).value;
    const twilioClient = twilio(twilioAccountSid, twilioAuthToken);
    const twilioNumber = (await keyVaultClient.getSecret('twilioPhoneNumber')).value;
    const maxAlertsToBeSent = 3;

    //Get all configurations from CosmosDB, multiple configurations supported. Expected to have one configurations per family
    const querySpec = {
      query: 'SELECT * from configurations'
    }
    const { resources: results } = await cosmosClient
    .database(databaseId)
    .container(containerId)
    .items.query(querySpec)
    .fetchAll()

    //For every configuration, trigger the CoWIN findByDistrict API
    //This API is used to get planned vaccination sessions on a specific date in a given district.
    for (var queryResult of results) {
      responseMessage.CosmosConfigRetrieval = "SUCCESS";
      //Proceed only if the configuration is active
      if(queryResult.active == '1'){

        const todayDate = new Date();
        const today = todayDate.getDate()+"-"+(parseInt(todayDate.getMonth()) + 1)+"-"+todayDate.getFullYear();
        const bookingDate = (req.query.bookingDate || (req.body && req.body.bookingDate) || today);
        responseMessage.BookingDate = bookingDate;
        const bookingDistrict = (queryResult.district || req.query.bookingDistrict || (req.body && req.body.bookingDistrict) || '269');
        const alertMobileNumber1 = queryResult.alertMobileNumber1;
        const alertMobileNumber2 = queryResult.alertMobileNumber2;

        context.log.info("Booking date is "+bookingDate);
        axios.defaults.timeout = 7000;
        await axios.get(process.env["CoWINAPIURLFindByDistrict"], {
          headers: {
            'Token': queryResult.token,
            'User-Agent': 'Chrome/90.0.4430.93'
          },
          params: {
              district_id: bookingDistrict,
              date: bookingDate
          }
        })
        .then(function (response) {
          //In case of HTTP 2xx
          responseMessage.CoWINIntegration = "SUCCESS"
          if(Object.keys(response.data.sessions).length == 0){
            //No sessions available
            context.log.info("No sessions available for "+bookingDate);
            //console.log("No sessions available for "+bookingDate);
          }else{
            //Sessions available
            context.log.info("Sessions are available for "+bookingDate);
            context.log.info(response.data.sessions);
            //console.log("Sessions are available for "+bookingDate);
            //console.log(response.data.sessions);

            //Place a call in case max number of alerts are not crossed and alert number is configured
            if((queryResult.mobileNumber1AlertsSent < maxAlertsToBeSent) && (alertMobileNumber1.length != 0)){
              twilioClient.calls
              .create({
                twiml: '<Response><Say>Vaccination sessions are available</Say></Response>',
                to: alertMobileNumber1,
                from: twilioNumber
              })
              .then(function (response) {
                //call => context.log.info("Raised alert to "+alertMobileNumber1+", Reference SID is: "+call.sid);
                responseMessage.alert1 = "SUCCESS";
                queryResult.mobileNumber1AlertsSent=queryResult.mobileNumber1AlertsSent + 1;
                cosmosClient.database(databaseId).container(containerId).item(queryResult.id, queryResult.mobileNumber).replace(queryResult);
                responseMessage.CosmosUpdate1 = "SUCCESS";
              })
              .catch(function (error){
                responseMessage.alert1 = "ERROR";
                context.log.error('ERROR: '+error);
              });
            }else{
              responseMessage.alert1 = "IGNORE";
              context.log.warn("Alerts will not be sent for Alert Number1 which is "+alertMobileNumber1);
            }

            if((queryResult.mobileNumber2AlertsSent < maxAlertsToBeSent) && (alertMobileNumber2.length != 0)){
              twilioClient.calls
              .create({
                twiml: '<Response><Say>Vaccination sessions are available</Say></Response>',
                to: alertMobileNumber2,
                from: twilioNumber
              })
              .then(function (response) {
                //call => context.log.info("Raised alert to "+alertMobileNumber2+", Reference SID is: "+call.sid);
                responseMessage.alert2 = "SUCCESS";
                queryResult.mobileNumber2AlertsSent=queryResult.mobileNumber2AlertsSent + 1;
                cosmosClient.database(databaseId).container(containerId).item(queryResult.id, queryResult.mobileNumber).replace(queryResult);
                responseMessage.CosmosUpdate2 = "SUCCESS";
              })
              .catch(function (error){
                responseMessage.alert2 = "ERROR";
                context.log.error('ERROR: '+error);
              });
            }else{
              responseMessage.alert2 = "IGNORE";
              context.log.warn("Alerts will not be sent for Alert Number2 which is "+alertMobileNumber2);
            }

          }
        })
        .catch(function (error) {
          //In case of HTTP 4xx or 5xx
          responseMessage.CoWINIntegration = "ERROR";
          context.log.error('ERROR: '+error);
        })
        .then(function () {
          // always executed
        });
      }else{
        responseMessage.CoWINIntegration = "IGNORE";
        context.log.warn("Skipped since configuration is inactive");
      }

    }

    console.log(responseMessage);
    context.res = {
        // status: 200, /* Defaults to 200 */
        body: responseMessage
    };
}