
module.exports = async function (context, req) {
    //Required libraries
    const axios = require('axios');
    const CosmosClient = require("@azure/cosmos").CosmosClient;

    const todayDate = new Date();
    const today = todayDate.getDate()+"-"+(parseInt(todayDate.getMonth()) + 1)+"-"+todayDate.getFullYear();

    //CosmosDB connection details
    const url = require('url');
    const endpoint = 'https://vikascowin.documents.azure.com:443/';
    const key = 'Lp7TkZRi231V3K34rmg6gHeVCWOomln0HPa1FbdnLnY83eAeaN5fHbfwH3zWPmvGckJV74ZhcodgqUy4nyK6kQ==';
    const databaseId = 'COWINConfiguration';
    const containerId = 'configurations';
    const partitionKey = { kind: 'Hash', paths: ['/mobileNumber'] };
    const client = new CosmosClient({ endpoint, key });
    context.log.info('CheckCoWinSlots function has been trigerred');

    //Get all configurations from CosmosDB
    const querySpec = {
      query: 'SELECT * from configurations'
    }
    const { resources: results } = await client
    .database(databaseId)
    .container(containerId)
    .items.query(querySpec)
    .fetchAll()

    //For every configuration, trigger the CoWIN findByDistrict API
    //This API is used to get planned vaccination sessions on a specific date in a given district.
    for (var queryResult of results) {
      let resultString = JSON.stringify(queryResult)
      //context.log.info(`\tQuery returned ${resultString}\n`)

      //Proceed only if the configuration is active
      if(queryResult.active == '1'){
        const bookingDate = (req.query.bookingDate || (req.body && req.body.bookingDate) || today);
        const bookingDistrict = (queryResult.district || req.query.bookingDistrict || (req.body && req.body.bookingDistrict) || '269');
        console.log("Booking date is "+bookingDate);
        axios.defaults.timeout = 7000;
        axios.get('https://cdn-api.co-vin.in/api/v2/appointment/sessions/public/findByDistrict', {
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
          if(Object.keys(response.data.sessions).length == 0){
            //No sessions available
            context.log.info("No sessions available for "+bookingDate);
            console.log("No sessions available for "+bookingDate);
          }else{
            //Sessions available
            context.log.info("Sessions are available for "+bookingDate);
            context.log.info(response.data.sessions);
            console.log("Sessions are available for "+bookingDate);
            console.log(response.data.sessions);
            //Place a call
          }
        })
        .catch(function (error) {
          //In case of HTTP 4xx or 5xx
          context.log.error('ERROR: '+error);
          //In case of a HTTP 403, the specific configuration will be disabled unless the token has been updated in CosmosDB
          //const documentToUpdate = client.database(databaseId).container(containerId).item(queryResult.id, queryResult.mobileNumber);
          //documentToUpdate.active='0';
          //const { resource: updatedItem } = client.database(databaseId).container(containerId).item(queryResult.id, queryResult.mobileNumber).replace(documentToUpdate);
        })
        .then(function () {
          // always executed
        });
      }else{
        context.log.warn("Skipped since configuration is inactive");
      }

    }

    const responseMessage = "Completed";
    context.res = {
        // status: 200, /* Defaults to 200 */
        body: responseMessage
    };
}