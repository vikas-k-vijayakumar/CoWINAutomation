module.exports = async function (context, myTimer) {
    //Required libraries
    const axios = require('axios');
    var timeStamp = new Date().toISOString();
    
    if (myTimer.isPastDue)
    {
        context.log('CoWIN Timer is running late!');
    }
    context.log('CoWIN Timer ran!', timeStamp);   


};