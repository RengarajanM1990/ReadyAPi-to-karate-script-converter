var figlet = require('figlet');
const [, , ...args] = process.argv;

/*figlet.fonts(function(err, fonts) {
    if (err) {
        console.log('something went wrong...');
        console.dir(err);
        return;
    }
    console.dir(fonts);
});*/

/**
 * ANSI Shadow.
 * Digital
 */
figlet.text(
    'Ready API TO Karate Converter',
    {
        font: args[0],
        horizontalLayout: 'full',
        verticalLayout: 'full ',
    },
    function(err, data) {
        if (err) {
            console.log('Something went wrong...');
            console.dir(err);
            return;
        }
        console.log(data);
    }
);
