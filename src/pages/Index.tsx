import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const Index = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Welcome to Your Blank App</h1>
        <p className="text-xl text-muted-foreground">Start building your amazing project here!</p>
        <div>
          <Button asChild>
            <Link to="/bulk-sms">Open Bulk SMS Tool</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Index;
