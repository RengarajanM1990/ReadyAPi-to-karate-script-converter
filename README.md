**README**

This module can be used to convert a ReadyAPI TestSuite into a karate feature files.

You'll need a reference to the directory that the 'Composite Project' was exported to, and the name of the 'TestSuite' service.

Note : your project must have a project.content file in the base directory of the project you would like to convert.

READYAPI_VERSION :

```bash
2.6.0 or Above (Need project.content file in script project folder, if its not present then import the project in ReadyApi and save, Project.content would be automatically generated).
```

Usage:

```bash
# to download/update dependecies :

npm install or yarn install

# to convert individual Test-Suite :

./cli.js <path to composite project dump> <name of test suite>

example:
./cli.js path/to/flex-event-snapshot-service/ SnapshotService/

# to convert whole project :

./multiConverterJenkins.sh  <path to composite project dump>

 example:
./multiConverterJenkins.sh path/to/flex-event-snapshot-service/

```

The output will be a fetaure files & some environment files in configs folder that you can import into automation-starter.

[wiki page](https://wiki.cvent.com/display/QE/Ready-Api+to+karate+script+converter)
