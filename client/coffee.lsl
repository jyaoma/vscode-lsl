integer flag = 0;
vector rezOffset = <0.02770, -0.01748, -0.01942>;
integer COM_CHANNEL = -260901;
key touchie;
integer listenHandle;


default
{
    state_entry() {
        listenHandle = llListen(COM_CHANNEL, "", "", "");
    }

    on_rez( integer start_param)
    {
        llSetTimerEvent(0);
    }

    run_time_permissions(integer permit) {
        if(flag == -1 && permit & PERMISSION_ATTACH && permit & PERMISSION_TRIGGER_ANIMATION) {
            llAttachToAvatarTemp( ATTACH_RHAND);
            llSetTimerEvent(7);
            llStartAnimation("hold_rhand");
            llListenRemove(listenHandle);
        } else if (flag >= 0) {
            if(flag == 0)
            {
            llStartAnimation("Drink B2");
            llSetRot(<0.17500, 0.71623, 0.18270, 0.65039>);
            llSetPos(<0.02770, -0.01748, -0.01942>);
            llSleep(10);
            }
            
            flag++;
            
            if(flag == 6)
            {
                flag = 0;
                llStopAnimation("hold_rhand");
                llStopAnimation("Drink B2");
                llSleep(0.5);
                llSetTimerEvent(0);
                llDetachFromAvatar();
            }   
        } else {
            llSleep(5);
            llDie();
        }
    }

//    attach(key attached)
 //   {
 //   llStopAnimation("hold_rhand");
 //   }
   
   timer()
   {
    llRequestPermissions(touchie,PERMISSION_ATTACH|PERMISSION_TRIGGER_ANIMATION);
    
    }
       
     listen(integer channel, string name, key id, string message)
    {
        llOwnerSay("I heard: " + message);
        touchie = (key)message;
        llRequestPermissions(touchie,PERMISSION_ATTACH|PERMISSION_TRIGGER_ANIMATION);
        flag = -1;
    }
}