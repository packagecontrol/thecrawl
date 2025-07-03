<!-- https://packagecontrol.io/docs/messaging -->
<!-- https://github.com/wbond/packagecontrol.io/blob/master/app/html/docs/messaging.html -->

# Messaging

If you’ve used many packages with Sublime Text and Package Control, you may have noticed situations where Package Control shows messages. Currently it is possible to show users a message when the package is installed, or after upgrades.

Messaging is controlled by a file named messages.json in the root of the package. The _[example-messages.json][2]_ file shows the proper structure of the JSON. Each value will be a file path that is relative to the package root. Each key will either be the string install or a version number.

When a package is installed, if the key install is present in the messages.json file, the value will be used as the file path to a txt file containing a message to display the user.

When a package is upgraded, Package Control looks through each key in the messages.json file and shows the content of the text file that is a value of any key that is higher than the previous version of the package the user has installed. Thus if the user had version 1.1.0 installed, the txt files for 1.2.0 and 1.1.1 would be shown. If the user had version 1.1.1 installed, only the messages for version 1.2.0 would be shown.

[1]: /docs
[2]: https://raw.githubusercontent.com/wbond/package_control/master/example-messages.json
