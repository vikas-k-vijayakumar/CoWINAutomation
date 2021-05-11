module.exports = async function (context, myTimer) {
    var timeStamp = new Date().toISOString();
    
    if (myTimer.isPastDue)
    {
        context.log('CoWIN Timer is running late!');
    }
    context.log('CoWIN Timer ran!', timeStamp);   


};