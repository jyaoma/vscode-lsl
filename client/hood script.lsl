// I'm going to make these constants so I can reference them
string linkNameHoodUp = "Hood UP";
string linkNameHoodDown = "Hood_Down4";
string linkNameMask = "Dark Mask";

integer raised;
key owner;
string sound;

// I'm going to declare the global variables first
integer linkHoodUp;
integer linkHoodDown;
integer linkMask;

default
{
    state_entry()
    {
        owner = llGetOwner();
        sound = llGetInventoryName(INVENTORY_SOUND, 0);

        // Here is where I'm going to add the code that does the logic I described
        // First get the number of linked prims
        integer numberOfLinkedPrims = llGetNumberOfPrims();

        // so this is where I do a loop to go through every link
        integer currentLinkNum;
        for (currentLinkNum = 0; currentLinkNum <= numberOfLinkedPrims; currentLinkNum++) {
            // ^ this is the basic syntax of a for loop
            // currentLinkNum = 0; <- this is set at the beginning of the loop
            // currentLinkNum <= numberOfLinkedPrims <- The loop continues as long as this condition is true
            // currentLinkNum++ <- The ++ operator increments the value of the variable. and this part of the
            //   for loop is run every iteration

            // get the name of the current link
            string linkName = llGetLinkName(currentLinkNum);

            // check if it matches any of the prims we care about
            if (linkName == linkNameHoodUp) {
                linkHoodUp = currentLinkNum;
            }
            if (linkName == linkNameHoodDown) {
                linkHoodDown = currentLinkNum;
            }
            if (linkName == linkNameMask) {
                linkMask = currentLinkNum;
            }
        }

        // now we replace usages of the link number constants with our computed values

        llSetLinkAlpha(linkHoodDown, 0.0, ALL_SIDES); // set the initital position 
        llSetLinkAlpha(linkHoodUp, 1.0, ALL_SIDES); // as visor down   
        llSetLinkAlpha(linkMask, 1.0, ALL_SIDES);    
        raised = FALSE;
        
    }
    touch_start(integer total_number)
    {
        if(llDetectedKey(0) == owner)
        {
            if(raised == FALSE)   // raise visor
            {
                if(sound != "") llPlaySound(sound, 1);
                llSetLinkAlpha(linkHoodDown, 1.0, ALL_SIDES); 
                llSetLinkAlpha(linkHoodUp, 0.0, ALL_SIDES); 
                llSetLinkAlpha(linkMask, 0.0, ALL_SIDES);
                raised = TRUE;
                return;
            }
            if(raised == TRUE) // lower visor
            {
                if(sound != "") llPlaySound(sound, 1);                
                llSetLinkAlpha(linkHoodDown, 0.0, ALL_SIDES);
                llSetLinkAlpha(linkHoodUp, 1.0, ALL_SIDES); 
                llSetLinkAlpha(linkMask, 1.0, ALL_SIDES);
                raised = FALSE;
                return;
            }

            // ok feel free to copy this and see if this works
        }                               
    }
    changed(integer change)
    {
        if (change & CHANGED_OWNER)
        {
            llResetScript();
        }
    }
}
