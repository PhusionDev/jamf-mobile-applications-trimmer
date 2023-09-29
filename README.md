# Jamf iOS application removal tool

## Why the tool?

This application was created to remove mobile applications from a Jamf Pro instance

Through the web application, there is no way to remove applications in bulk, leading to a clunky user experience.

## What can it do?

- Get an auth token from Jamf using your provided credentials
- Get a list of all mobile applications currently on the JSS instance
- Get extended VPP (volume purchasing) information from loaded apps
  - Can be done all at once
  - Can be done with a specified range
- Sort applications into "buckets" based on their VPP data
  - Unlicensed (apps that don't have a VPP license)
  - Licensed Unpurchased (apps that have a VPP license, but 0 purchased)
  - Licensed Purchased In Use (apps that have a license, total purchased > 0, and > 1 in use)
  - Licensed Purchased Not In Use (apps that have a license, total purchased > 0, but none in use)
  - Other (fallback for any applications that slip through the other buckets)
- Export a readable, sorted list of applications
- Delete applications from individual buckets

## Installation / setup

- Install node onto your system
- run 'npm i' to install dependencies
- rename the included .env.example to .env
- modify .env with your Jamf credentials

## Program flags

- --apps (fetch all apps from JSS)
- --vpp (fetch vpp data for all loaded apps)
- --vpp-range # # (ex: --vpp-range 0 50) (fetch vpp data for a range in loaded apps)
- --delete-unlicensed (delete apps in the unlicensed bucket)
- --delete-licensed-unpurchased (delete apps in the licensed but unpurchased bucket)
- --delete-licensed-not-in-use (delete apps in the licensed, purchased, but not in use bucket)
- --delete-licensed-in-use (delete apps in the licensed, purchased, andin use bucket)
  - !! This is included only for completion sake, probably don't ever want/need to use it!
- --delete-other (delete apps that fall into the other bucket)

## Typical usage

You will likely want to use this tool to remove applications from your JSS that are either **unlicensed** or **licensed without purchase**.
A typical flow for this would be as follows:

1. node index.js --apps --vpp-range 0 50
2. review the list in **results.txt**
3. if there are apps that fall into those categories proceed to run:
   1. node index.js --delete-unlicensed --delete-licensed-unpurchased
      1. In my own testing I deleted buckets one at a time. 2 flags should work, but I haven't personally tested this.

_Continue to run steps 1-3, reviewing the results.txt as many times as needed_

_If you would rather get all apps and vpp data in one go you could also do:_

1. node index.js --apps --vpp
   1. **this might take a long time if you have many apps!!**
2. review the list in **results.txt**
3. node index.js --delete-unlicensed --delete-licensed-unpurchased
   1. In my own testing I deleted buckets one at a time. 2 flags should work, but I haven't personally tested this.

## Bugs?

I have tried my best in the past 24 hours to squash any bugs that I've personally encountered when developing and using this application for my own use case, but I would be naive to think it's bug-free. With that being said, feel free to fork or make modifications as you wish.

## Disclaimer

While I have taken precautions to prevent unwanted behavior from the application, if you choose to run this software you agree that you do so at your own risk. I cannot be held responsible for any data that is missing from your own Jamf instance. The source code is all there for you to review, and I would highly suggest examining the **results.txt** file in great detail before running any of the delete flags. I would also highly encourage you to get smaller batches of VPP data so that you can test things on your Jamf instance. Use the --vpp-range flag to limit how many applications get sorted into these buckets to control the level of deletion.
