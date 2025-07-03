<!-- https://packagecontrol.io/docs/renaming_a_package -->
<!-- https://github.com/wbond/packagecontrol.io/blob/master/app/html/docs/renaming_a_package.html -->

# Renaming a Package

The following guide will step you through the process of renaming a package you have submitted to Package Control.

## 1\. Review the New Name

*   Read the [naming guidelines][2] to make sure your new name will work.

## 2\. Fork the Channel

1.  Fork the [Package Control Channel][3].
2.  Clone your fork to your machine
3.  Open the package\_control\_channel/ folder with Sublime Text

## 3\. Update the Repository

1.  Remove your package entry from its old location. It will be in one of the JSON files in the repository/ sub-folder of package\_control\_channel/.
2.  Paste the package entry into the correct JSON file based on the new name. We keep package entries alphabetized to reduce conflicts when merging pull requests.
3.  Update the name key with the new name.
4.  Add a previous\_names key to the top-level JSON structure for your package. previous\_names needs to be an array of strings. For example:
    
    {
    	"name": "AlignmentPlus",
    	"previous\_names": \["Alignment"\],
    	"details": "https://bitbucket.org/wbond/sublime\_alignment",
    	"releases": \[
    		{
    			"sublime\_text": "\*",
    			"tags": true
    		}
    	\]
    }
    

## 4\. Run the Tests

1.  Install the [ChannelRepositoryTools][4] package via Package Control.
2.  Run the **ChannelRepositoryTools: Test Default Channel** command from the command palette and ensure the tests pass.

## 5\. Submit a Pull Request

1.  Browse to your fork on [github.com][5]
2.  Click on **Pull Requests** in the right-hand nav and click **New Pull Request**
3.  Enter a description in the **Title** field
4.  Click the **Create pull request** button

[1]: /docs
[2]: /docs/submitting_a_package#Step_2
[3]: https://github.com/wbond/package_control_channel
[4]: /packages/ChannelRepositoryTools
[5]: https://github.com
